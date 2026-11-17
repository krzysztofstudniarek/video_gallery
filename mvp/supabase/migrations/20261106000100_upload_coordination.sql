-- Serialize direct app-authored inserts and upload reservations on the account row.
create function videoalbum_private.enforce_capacity() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if current_setting('role')='authenticated' and new.owner_id is distinct from auth.uid() then
    raise exception 'Owner mismatch' using errcode='42501';
  end if;
  perform 1 from auth.users where id=new.owner_id for update;
  if tg_table_name='albums' then
    if (select count(*) from public.albums where owner_id=new.owner_id)>=5 then
      raise exception 'album_capacity' using errcode='23514';
    end if;
  elsif (select count(*) from public.videos where owner_id=new.owner_id)>=200 or
        (select count(*) from public.videos where album_id=new.album_id and owner_id=new.owner_id)>=50 then
    raise exception 'video_capacity' using errcode='23514';
  end if;
  return new;
end $$;
create trigger album_capacity before insert on public.albums for each row execute function videoalbum_private.enforce_capacity();
create trigger video_capacity before insert on public.videos for each row execute function videoalbum_private.enforce_capacity();

-- Operations may lower limits without a frontend release. Raising pilot ceilings needs a new decision.
create table videoalbum_private.upload_policy (
  singleton boolean primary key default true check(singleton),
  max_bytes bigint not null default 1073741824 check(max_bytes between 1 and 1073741824),
  max_seconds integer not null default 600 check(max_seconds between 1 and 600),
  account_daily integer not null default 20 check(account_daily between 1 and 20),
  project_daily integer not null default 60 check(project_daily between 1 and 60),
  project_active integer not null default 3 check(project_active between 1 and 3)
);
insert into videoalbum_private.upload_policy(singleton) values(true);
alter table videoalbum_private.upload_policy enable row level security;
revoke all on videoalbum_private.upload_policy from public,anon,authenticated;
grant all on videoalbum_private.upload_policy to service_role;

alter table videoalbum_private.upload_idempotency add column terminal_state text check(terminal_state in ('cancelled','purged'));

create function public.upload_job_receipt(p_owner uuid,p_job uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('jobId',i.job_id,'workflowId',i.workflow_id,'state',i.terminal_state)
  from videoalbum_private.upload_idempotency i join public.profiles p on p.owner_id=i.owner_id
  where i.owner_id=p_owner and i.job_id=p_job and i.terminal_state='cancelled' and p.deletion_requested_at is null
$$;
revoke all on function public.upload_job_receipt(uuid,uuid) from public,anon,authenticated;
grant execute on function public.upload_job_receipt(uuid,uuid) to service_role;

create table videoalbum_private.upload_controls (
  job_id uuid primary key references public.upload_jobs(id) on delete cascade,
  declared_bytes bigint not null check(declared_bytes between 1 and 1073741824),
  file_sha256 text not null check(file_sha256 ~ '^[0-9a-f]{64}$'),
  made_for_kids boolean not null,
  dispatched_at timestamptz,
  queue_until timestamptz,
  lease_id uuid,
  lease_until timestamptz,
  ambiguous boolean not null default false,
  poll_count integer not null default 0,
  next_poll_at timestamptz,
  failure_code text
);
-- No provider material: cancellation cannot reset the Pacific-day initiation budget.
create table videoalbum_private.upload_daily (
  pacific_day date not null,
  bucket text not null,
  attempts integer not null default 0,
  last_dispatched_at timestamptz,
  primary key(pacific_day,bucket)
);
alter table videoalbum_private.upload_controls enable row level security;
alter table videoalbum_private.upload_daily enable row level security;
revoke all on videoalbum_private.upload_controls,videoalbum_private.upload_daily from public,anon,authenticated;
grant all on videoalbum_private.upload_controls,videoalbum_private.upload_daily to service_role;

create function public.create_upload_job(p_owner uuid,p_workflow uuid,p_key uuid,p_title text,
  p_description text,p_caption text,p_visibility text,p_public boolean,p_size bigint,p_hash text,p_kids boolean)
returns uuid language plpgsql security definer set search_path='' as $$
declare w public.upload_workflows; j public.upload_jobs; v uuid; jid uuid;
begin
  perform 1 from auth.users where id=p_owner for update;
  select * into w from public.upload_workflows where id=p_workflow and owner_id=p_owner for update;
  if not found or w.expires_at<=clock_timestamp() or not exists(select 1 from public.channel_library_context(p_owner,p_workflow)) then
    raise exception 'workflow_unavailable' using errcode='42501';
  end if;
  if p_key is null or p_title is null or length(btrim(p_title)) not between 1 and 100 or p_title ~ '[<>]' or
     p_description is null or octet_length(p_description)>5000 or p_description ~ '[<>]' or
     p_caption is null or length(p_caption)>2000 or p_visibility is null or p_visibility not in ('private','unlisted','public') or
     p_public is null or (p_visibility='public' and not p_public) or p_size is null or p_size not between 1 and (select max_bytes from videoalbum_private.upload_policy) or
     p_hash is null or p_hash !~ '^[0-9a-f]{64}$' or p_kids is null then
    raise exception 'invalid_upload_request' using errcode='23514';
  end if;
  select * into j from public.upload_jobs where owner_id=p_owner and idempotency_key=p_key;
  if found then
    if (j.workflow_id,j.upload_title,j.upload_description,j.requested_visibility) is distinct from
       (p_workflow,p_title,p_description,p_visibility) or not exists(
      select 1 from videoalbum_private.upload_controls c where c.job_id=j.id and c.declared_bytes=p_size
        and c.file_sha256=p_hash and c.made_for_kids=p_kids) then
      raise exception 'idempotency_conflict' using errcode='23505';
    end if;
    return j.id;
  end if;
  if exists(select 1 from videoalbum_private.upload_idempotency where owner_id=p_owner and idempotency_key=p_key) then
    raise exception 'idempotency_already_finished' using errcode='23505';
  end if;
  if (select count(*) from videoalbum_private.upload_idempotency where workflow_id=p_workflow)>=10 then
    raise exception 'batch_capacity' using errcode='23514';
  end if;
  v:=gen_random_uuid(); jid:=gen_random_uuid();
  insert into public.videos(id,owner_id,album_id,caption) values(v,p_owner,w.album_id,p_caption);
  insert into videoalbum_private.upload_idempotency(owner_id,idempotency_key,workflow_id,job_id)
    values(p_owner,p_key,p_workflow,jid);
  insert into public.upload_jobs(id,owner_id,workflow_id,album_id,video_id,idempotency_key,
    upload_title,upload_description,requested_visibility,public_confirmed_at)
    values(jid,p_owner,p_workflow,w.album_id,v,p_key,p_title,p_description,p_visibility,
      case when p_visibility='public' then clock_timestamp() end);
  insert into videoalbum_private.upload_controls(job_id,declared_bytes,file_sha256,made_for_kids)
    values(jid,p_size,p_hash,p_kids);
  return jid;
end $$;

create function public.upload_job_context(p_owner uuid,p_job uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('job',to_jsonb(j),'control',to_jsonb(c),'session',to_jsonb(s),'connection',to_jsonb(x),'limits',(select to_jsonb(policy) from videoalbum_private.upload_policy policy))
  from public.upload_jobs j join videoalbum_private.upload_controls c on c.job_id=j.id
  join lateral public.channel_library_context(p_owner,j.workflow_id) x on true
  left join videoalbum_private.upload_sessions s on s.job_id=j.id and s.expires_at>statement_timestamp()
  where j.owner_id=p_owner and j.id=p_job
$$;

-- Atomic one-use dispatch claim. Ambiguous claims are never automatically reinitiated.
create function public.claim_upload_dispatch(p_owner uuid,p_job uuid,p_lease uuid)
returns text language plpgsql security definer set search_path='' as $$
declare j public.upload_jobs; c videoalbum_private.upload_controls; d date; next_job uuid;
begin
  perform pg_advisory_xact_lock(150060);
  perform 1 from auth.users where id=p_owner for update;
  if public.upload_job_context(p_owner,p_job) is null then return 'workflow_unavailable'; end if;
  select * into j from public.upload_jobs where id=p_job for update;
  select * into c from videoalbum_private.upload_controls where job_id=p_job for update;
  if c.dispatched_at is not null or j.state<>'queued' then return 'reconcile_existing_job'; end if;
  update videoalbum_private.upload_controls set queue_until=clock_timestamp()+interval '30 seconds' where job_id=p_job;
  d:=(clock_timestamp() at time zone 'America/Los_Angeles')::date;
  insert into videoalbum_private.upload_daily(pacific_day,bucket) values(d,'project'),(d,p_owner::text) on conflict do nothing;
  if (select attempts from videoalbum_private.upload_daily where pacific_day=d and bucket='project')>=(select project_daily from videoalbum_private.upload_policy) then return 'project_daily_quota'; end if;
  if (select attempts from videoalbum_private.upload_daily where pacific_day=d and bucket=p_owner::text)>=(select account_daily from videoalbum_private.upload_policy) then return 'account_daily_quota'; end if;
  if exists(select 1 from videoalbum_private.upload_controls a join public.upload_jobs b on b.id=a.job_id
    where a.lease_until>clock_timestamp() and b.owner_id=p_owner and b.state in ('initiating','transferring')) then return 'account_transfer_busy'; end if;
  if (select count(*) from videoalbum_private.upload_controls a join public.upload_jobs b on b.id=a.job_id
    where a.lease_until>clock_timestamp() and b.state in ('initiating','transferring'))>=(select project_active from videoalbum_private.upload_policy) then return 'project_transfer_busy'; end if;
  select q.id into next_job from public.upload_jobs q
    join videoalbum_private.upload_controls qc on qc.job_id=q.id
    join lateral public.channel_library_context(q.owner_id,q.workflow_id) x on true
    left join videoalbum_private.upload_daily daily on daily.pacific_day=d and daily.bucket=q.owner_id::text
    where q.state='queued' and qc.dispatched_at is null and qc.queue_until>clock_timestamp() and coalesce(daily.attempts,0)<(select account_daily from videoalbum_private.upload_policy)
      and not exists(select 1 from videoalbum_private.upload_controls ac join public.upload_jobs aj on aj.id=ac.job_id
        where aj.owner_id=q.owner_id and ac.lease_until>clock_timestamp() and aj.state in ('initiating','transferring'))
    order by daily.last_dispatched_at nulls first,q.created_at,q.id limit 1;
  if next_job is distinct from p_job then return 'waiting_turn'; end if;
  update videoalbum_private.upload_daily set attempts=attempts+1,last_dispatched_at=clock_timestamp()
    where pacific_day=d and bucket in ('project',p_owner::text);
  update videoalbum_private.upload_controls set dispatched_at=clock_timestamp(),lease_id=p_lease,
    lease_until=clock_timestamp()+interval '90 seconds',ambiguous=true where job_id=p_job;
  update videoalbum_private.upload_idempotency set initiation_claimed_at=clock_timestamp() where job_id=p_job;
  update public.upload_jobs set state='initiating' where id=p_job;
  return 'claimed';
end $$;

create function public.save_upload_session(p_owner uuid,p_job uuid,p_lease uuid,p_cipher text,p_key_id text)
returns boolean language plpgsql security definer set search_path='' as $$
declare j public.upload_jobs; deadline timestamptz;
begin
  perform 1 from auth.users where id=p_owner for update;
  if public.upload_job_context(p_owner,p_job) is null then return false; end if;
  select * into j from public.upload_jobs where id=p_job and owner_id=p_owner for update;
  if j.state<>'initiating' or not exists(select 1 from videoalbum_private.upload_controls where job_id=p_job
      and lease_id=p_lease and lease_until>clock_timestamp()) then return false; end if;
  select expires_at into deadline from public.upload_workflows where id=j.workflow_id;
  insert into videoalbum_private.upload_sessions(job_id,workflow_id,owner_id,session_cipher,key_id,expires_at)
    values(p_job,j.workflow_id,p_owner,p_cipher,p_key_id,deadline);
  update public.upload_jobs set state='transferring' where id=p_job;
  update videoalbum_private.upload_controls set ambiguous=false where job_id=p_job;
  return true;
end $$;

-- A short exclusive lease, checked again before every browser chunk.
create function public.upload_transfer_permit(p_owner uuid,p_job uuid,p_lease uuid,p_acquire boolean default false)
returns boolean language plpgsql security definer set search_path='' as $$
declare c videoalbum_private.upload_controls;
begin
  perform pg_advisory_xact_lock(150060);
  perform 1 from auth.users where id=p_owner for update;
  if public.upload_job_context(p_owner,p_job) is null or not exists(
    select 1 from public.upload_jobs where id=p_job and state='transferring') then return false; end if;
  select * into c from videoalbum_private.upload_controls where job_id=p_job for update;
  if c.lease_id is distinct from p_lease and (not p_acquire or c.lease_until>clock_timestamp()) then return false; end if;
  if not p_acquire and (c.lease_until is null or c.lease_until<=clock_timestamp()) then return false; end if;
  if exists(select 1 from videoalbum_private.upload_controls a join public.upload_jobs b on b.id=a.job_id
    where a.job_id<>p_job and a.lease_until>clock_timestamp() and b.owner_id=p_owner and b.state in ('initiating','transferring')) or
    (select count(*) from videoalbum_private.upload_controls a join public.upload_jobs b on b.id=a.job_id
      where a.job_id<>p_job and a.lease_until>clock_timestamp() and b.state in ('initiating','transferring'))>=(select project_active from videoalbum_private.upload_policy) then return false; end if;
  update videoalbum_private.upload_controls set lease_id=p_lease,lease_until=clock_timestamp()+interval '90 seconds' where job_id=p_job;
  return true;
end $$;

create function public.upload_poll_claim(p_owner uuid,p_job uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  perform 1 from auth.users where id=p_owner for update;
  if public.upload_job_context(p_owner,p_job) is null then return false; end if;
  update videoalbum_private.upload_controls set poll_count=poll_count+1,next_poll_at=clock_timestamp()+interval '5 seconds'
    where job_id=p_job and poll_count<120 and (next_poll_at is null or next_poll_at<=clock_timestamp());
  return found;
end $$;

create function public.record_upload_result(p_owner uuid,p_job uuid,p_video text,p_visibility text,
  p_processing text,p_channel boolean,p_size bigint,p_duration numeric,p_failure text default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare j public.upload_jobs;
begin
  perform 1 from auth.users where id=p_owner for update;
  if public.upload_job_context(p_owner,p_job) is null then return false; end if;
  select * into j from public.upload_jobs where id=p_job and owner_id=p_owner for update;
  if j.state in ('cancelled','failed') or (j.provider_video_id is not null and j.provider_video_id<>p_video) then return false; end if;
  update public.upload_jobs set provider_video_id=p_video,effective_visibility=p_visibility,
    processing_status=p_processing,channel_verified=p_channel,verified_size_bytes=p_size,
    verified_duration_seconds=p_duration,verified_at=clock_timestamp(),anonymous_playback_verified_at=null,
    state=case when p_failure is not null or p_processing='failed' then 'failed' else 'uploaded' end where id=p_job;
  update videoalbum_private.upload_controls set ambiguous=false,lease_id=null,lease_until=null,failure_code=p_failure where job_id=p_job;
  return true;
end $$;

create function public.cancel_upload_job(p_owner uuid,p_job uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  perform 1 from auth.users where id=p_owner for update;
  if public.upload_job_context(p_owner,p_job) is null then return false; end if;
  update videoalbum_private.upload_idempotency set terminal_state='cancelled' where owner_id=p_owner and job_id=p_job;
  -- Erase immutable provider inputs/session too; the idempotency tombstone and caption survive.
  delete from public.upload_jobs where id=p_job and owner_id=p_owner;
  return found;
end $$;

select cron.schedule('upload-quota-cleanup','7 8 * * *',
 $$delete from videoalbum_private.upload_daily where pacific_day < (clock_timestamp() at time zone 'America/Los_Angeles')::date - 2;$$);
revoke all on function videoalbum_private.enforce_capacity() from public,anon,authenticated;
revoke all on function public.create_upload_job(uuid,uuid,uuid,text,text,text,text,boolean,bigint,text,boolean),
 public.upload_job_context(uuid,uuid),public.claim_upload_dispatch(uuid,uuid,uuid),
 public.save_upload_session(uuid,uuid,uuid,text,text),public.upload_transfer_permit(uuid,uuid,uuid,boolean),
 public.upload_poll_claim(uuid,uuid),public.record_upload_result(uuid,uuid,text,text,text,boolean,bigint,numeric,text),
 public.cancel_upload_job(uuid,uuid) from public,anon,authenticated;
grant execute on function public.create_upload_job(uuid,uuid,uuid,text,text,text,text,boolean,bigint,text,boolean),
 public.upload_job_context(uuid,uuid),public.claim_upload_dispatch(uuid,uuid,uuid),
 public.save_upload_session(uuid,uuid,uuid,text,text),public.upload_transfer_permit(uuid,uuid,uuid,boolean),
 public.upload_poll_claim(uuid,uuid),public.record_upload_result(uuid,uuid,text,text,text,boolean,bigint,numeric,text),
 public.cancel_upload_job(uuid,uuid) to service_role;
