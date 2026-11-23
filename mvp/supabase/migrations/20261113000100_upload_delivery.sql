-- Playback evidence is produced by a trusted clean-browser worker, never by an owner checkbox.
create table videoalbum_private.playback_checks (
 job_id uuid primary key references public.upload_jobs(id) on delete cascade,
 verified_at timestamptz not null,
 state text not null default 'queued' check(state in ('queued','checking','passed','failed')),
 attempts integer not null default 0,
 claim uuid,
 lease_until timestamptz
);
create table videoalbum_private.workflow_downloads (
 workflow_id uuid primary key references public.upload_workflows(id) on delete cascade,
 batch_id uuid not null unique default gen_random_uuid(),
 snapshot text not null,
 created_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null,
 qr_count integer not null,
 sheet boolean not null default false,
 individual boolean not null default false,
 links boolean not null default false
);
alter table videoalbum_private.playback_checks enable row level security;
alter table videoalbum_private.workflow_downloads enable row level security;
revoke all on videoalbum_private.playback_checks,videoalbum_private.workflow_downloads from public,anon,authenticated;
grant all on videoalbum_private.playback_checks,videoalbum_private.workflow_downloads to service_role;

create function public.request_upload_playback(p_owner uuid,p_job uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare j public.upload_jobs;
begin
 perform 1 from auth.users where id=p_owner for update;
 if public.upload_job_context(p_owner,p_job) is null then return false; end if;
 select * into j from public.upload_jobs where id=p_job and owner_id=p_owner for update;
 if j.state<>'uploaded' or j.processing_status<>'succeeded' or not j.channel_verified or
   j.verified_at<clock_timestamp()-interval '5 minutes' or j.provider_video_id is null or
   j.requested_visibility<>j.effective_visibility or j.effective_visibility not in ('public','unlisted') or
   (j.effective_visibility='public' and j.public_confirmed_at is null) then return false; end if;
 insert into videoalbum_private.playback_checks(job_id,verified_at) values(p_job,j.verified_at)
 on conflict(job_id) do update set verified_at=excluded.verified_at,state='queued',claim=null,lease_until=null
   where playback_checks.attempts<12;
 return found;
end $$;
create function public.claim_upload_playback(p_claim uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare q videoalbum_private.playback_checks; j public.upload_jobs; result jsonb;
begin
 -- Do not hold a job row lock across worker network calls.
 select c.* into q from videoalbum_private.playback_checks c join public.upload_jobs u on u.id=c.job_id
 join public.upload_workflows w on w.id=u.workflow_id join public.profiles p on p.owner_id=u.owner_id
 where c.attempts<12 and (c.state='queued' or (c.state='checking' and c.lease_until<=clock_timestamp()))
   and u.verified_at=c.verified_at and c.verified_at>clock_timestamp()-interval '5 minutes'
   and w.expires_at>clock_timestamp() and p.deletion_requested_at is null
   and exists(select 1 from public.channel_library_context(u.owner_id,u.workflow_id))
 order by c.verified_at,c.job_id for update of c skip locked limit 1;
 if not found then return null; end if;
 update videoalbum_private.playback_checks set claim=p_claim,state='checking',attempts=attempts+1,
   lease_until=clock_timestamp()+interval '90 seconds' where job_id=q.job_id;
 select * into j from public.upload_jobs where id=q.job_id;
 return jsonb_build_object('jobId',j.id,'ownerId',j.owner_id,'videoId',j.provider_video_id);
end $$;
create function public.finish_upload_playback(p_claim uuid,p_passed boolean) returns boolean
language plpgsql security definer set search_path='' as $$
declare q videoalbum_private.playback_checks; j public.upload_jobs;
begin
 -- Owner lock uses the same order as disconnect and request mutations.
 select u.* into j from public.upload_jobs u join videoalbum_private.playback_checks c on c.job_id=u.id where c.claim=p_claim;
 if not found then return false; end if;
 perform 1 from auth.users where id=j.owner_id for update;
 select * into q from videoalbum_private.playback_checks where claim=p_claim for update;
 if not found or q.state<>'checking' or q.lease_until<=clock_timestamp() or
    public.upload_job_context(j.owner_id,j.id) is null then return false; end if;
 select * into j from public.upload_jobs where id=q.job_id for update;
 if j.verified_at is distinct from q.verified_at or j.state<>'uploaded' or j.processing_status<>'succeeded' or
    not j.channel_verified or j.requested_visibility<>j.effective_visibility or j.effective_visibility not in ('public','unlisted') or
    (j.effective_visibility='public' and j.public_confirmed_at is null) or j.verified_at<clock_timestamp()-interval '5 minutes' then return false; end if;
 update public.upload_jobs set anonymous_playback_verified_at=case when p_passed then clock_timestamp() end where id=j.id;
 update videoalbum_private.playback_checks set state=case when p_passed then 'passed' else 'failed' end,claim=null,lease_until=null where job_id=j.id;
 return true;
end $$;

-- Keep the existing view shape for video-library clients, but readiness now expires without a read/write.
create or replace view public.qr_ready_uploads with (security_invoker=true) as
select j.id,j.owner_id,j.workflow_id,j.video_id,j.provider_video_id,j.effective_visibility,j.verified_at
from public.upload_jobs j join public.upload_workflows w on w.id=j.workflow_id and w.owner_id=j.owner_id
where w.expires_at>statement_timestamp() and j.state='uploaded' and j.processing_status='succeeded'
 and j.channel_verified and j.verified_at>statement_timestamp()-interval '5 minutes'
 and j.anonymous_playback_verified_at>=j.verified_at and j.provider_video_id is not null
 and j.effective_visibility=j.requested_visibility and j.effective_visibility in ('public','unlisted')
 and (j.effective_visibility<>'public' or j.public_confirmed_at is not null)
 and j.verified_size_bytes between 1 and 1073741824 and j.verified_duration_seconds>0 and j.verified_duration_seconds<=600;

create function videoalbum_private.download_snapshot(p_workflow uuid) returns text
language sql stable set search_path='' as $$
 select encode(sha256(convert_to(jsonb_build_object('preset',a.qr_preset_id,'album',a.title,'jobs',
  (select jsonb_agg(jsonb_build_object('job',to_jsonb(j),'caption',v.caption,'sort',v.sort_order) order by v.sort_order,j.id)
    from public.upload_jobs j join public.videos v on v.id=j.video_id and v.owner_id=j.owner_id where j.workflow_id=p_workflow))::text,'UTF8')),'hex')
 from public.upload_workflows w join public.albums a on a.id=w.album_id and a.owner_id=w.owner_id where w.id=p_workflow
$$;
create function public.upload_delivery_context(p_owner uuid,p_workflow uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('workflowId',w.id,'expiresAt',w.expires_at,'albumId',a.id,'albumTitle',a.title,'preset',a.qr_preset_id,
 'jobs',(select coalesce(jsonb_agg(jsonb_build_object('jobId',j.id,'videoId',j.video_id,'caption',v.caption,
   'state',j.state,'processing',j.processing_status,'visibility',j.effective_visibility,'requestedVisibility',j.requested_visibility,
   'verifiedAt',j.verified_at,'qrEligible',exists(select 1 from public.qr_ready_uploads r where r.id=j.id)) order by v.sort_order,j.id),'[]'::jsonb)
   from public.upload_jobs j join public.videos v on v.id=j.video_id and v.owner_id=j.owner_id where j.workflow_id=w.id))
 from public.upload_workflows w join public.albums a on a.id=w.album_id and a.owner_id=w.owner_id
 join lateral public.channel_library_context(p_owner,p_workflow) c on true
 where w.id=p_workflow and w.owner_id=p_owner and w.expires_at>statement_timestamp()
$$;
create function public.prepare_upload_downloads(p_owner uuid,p_workflow uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare batch videoalbum_private.workflow_downloads; w public.upload_workflows; count_qr integer; snap text;
begin
 perform 1 from auth.users where id=p_owner for update;
 select * into w from public.upload_workflows where id=p_workflow and owner_id=p_owner for update;
 if not found or public.upload_delivery_context(p_owner,p_workflow) is null then raise exception 'workflow_unavailable' using errcode='42501'; end if;
 if not exists(select 1 from public.upload_jobs where workflow_id=p_workflow) or exists(
  select 1 from public.upload_jobs j where j.workflow_id=p_workflow and
   (j.state<>'uploaded' or j.processing_status<>'succeeded' or not j.channel_verified or j.verified_at is null or
    j.verified_at<clock_timestamp()-interval '5 minutes' or j.effective_visibility is distinct from j.requested_visibility or
    j.verified_size_bytes is null or j.verified_size_bytes>(select max_bytes from videoalbum_private.upload_policy) or
    j.verified_duration_seconds is null or j.verified_duration_seconds>(select max_seconds from videoalbum_private.upload_policy) or
    (j.requested_visibility<>'private' and not exists(select 1 from public.qr_ready_uploads r where r.id=j.id))))
 then raise exception 'verification_required' using errcode='23514'; end if;
 select count(*) into count_qr from public.qr_ready_uploads where workflow_id=p_workflow;
 snap:=videoalbum_private.download_snapshot(p_workflow);
 insert into videoalbum_private.workflow_downloads(workflow_id,snapshot,expires_at,qr_count)
  values(p_workflow,snap,least(w.expires_at,clock_timestamp()+interval '5 minutes',
    (select min(verified_at)+interval '5 minutes' from public.upload_jobs where workflow_id=p_workflow)),count_qr)
 on conflict(workflow_id) do update set batch_id=gen_random_uuid(),snapshot=excluded.snapshot,
   expires_at=excluded.expires_at,created_at=clock_timestamp(),qr_count=count_qr,sheet=false,individual=false,links=false
 returning * into batch;
 return jsonb_build_object('batchId',batch.batch_id,'expiresAt',batch.expires_at,'workflowId',w.id,
 'albumTitle',(select title from public.albums where id=w.album_id),'preset',(select qr_preset_id from public.albums where id=w.album_id),
 'entries',(select jsonb_agg(jsonb_build_object('videoId',v.id,'jobId',j.id,'caption',v.caption,'visibility',j.effective_visibility,
  'qrEligible',j.effective_visibility<>'private','destination','https://www.youtube.com/watch?v='||j.provider_video_id) order by v.sort_order,j.id)
 from public.upload_jobs j join public.videos v on v.id=j.video_id where j.workflow_id=w.id));
end $$;
create function public.acknowledge_upload_download(p_owner uuid,p_workflow uuid,p_batch uuid,p_kind text) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 perform 1 from auth.users where id=p_owner for update;
 if public.upload_delivery_context(p_owner,p_workflow) is null or p_kind not in ('sheet','individual','links') then return false; end if;
 update videoalbum_private.workflow_downloads set sheet=sheet or p_kind='sheet',individual=individual or p_kind='individual',links=links or p_kind='links'
 where workflow_id=p_workflow and batch_id=p_batch and expires_at>clock_timestamp()
   and snapshot=videoalbum_private.download_snapshot(p_workflow);
 return found;
end $$;
create function public.complete_upload_delivery(p_owner uuid,p_workflow uuid,p_batch uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare b videoalbum_private.workflow_downloads;
begin
 perform 1 from auth.users where id=p_owner for update;
 perform 1 from public.upload_workflows where id=p_workflow and owner_id=p_owner for update;
 if not found or public.upload_delivery_context(p_owner,p_workflow) is null then return false; end if;
 select * into b from videoalbum_private.workflow_downloads where workflow_id=p_workflow and batch_id=p_batch for update;
 if not found or b.expires_at<=clock_timestamp() or not b.links or (b.qr_count>0 and (not b.sheet or not b.individual)) or
  b.snapshot is distinct from videoalbum_private.download_snapshot(p_workflow) then return false; end if;
 update videoalbum_private.upload_idempotency set terminal_state='purged' where workflow_id=p_workflow and owner_id=p_owner;
 delete from public.upload_workflows where id=p_workflow and owner_id=p_owner;
 return found;
end $$;

revoke all on function videoalbum_private.download_snapshot(uuid) from public,anon,authenticated;
revoke all on function public.request_upload_playback(uuid,uuid),public.claim_upload_playback(uuid),public.finish_upload_playback(uuid,boolean),
 public.upload_delivery_context(uuid,uuid),public.prepare_upload_downloads(uuid,uuid),public.acknowledge_upload_download(uuid,uuid,uuid,text),
 public.complete_upload_delivery(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.request_upload_playback(uuid,uuid),public.claim_upload_playback(uuid),public.finish_upload_playback(uuid,boolean),
 public.upload_delivery_context(uuid,uuid),public.prepare_upload_downloads(uuid,uuid),public.acknowledge_upload_download(uuid,uuid,uuid,text),
 public.complete_upload_delivery(uuid,uuid,uuid) to service_role;

create function public.upload_delivery_receipt(p_owner uuid,p_workflow uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from videoalbum_private.upload_idempotency i join public.profiles p on p.owner_id=i.owner_id
 where i.workflow_id=p_workflow and i.owner_id=p_owner and i.terminal_state='purged' and p.deletion_requested_at is null)
$$;
revoke all on function public.upload_delivery_receipt(uuid,uuid) from public,anon,authenticated;
grant execute on function public.upload_delivery_receipt(uuid,uuid) to service_role;
create unique index playback_claim_unique on videoalbum_private.playback_checks(claim) where claim is not null;
