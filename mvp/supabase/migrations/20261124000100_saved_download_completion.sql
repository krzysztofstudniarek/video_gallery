-- Download freshness gates generation and acknowledgements, not cleanup of files already saved.
-- Owner, live workflow, complete receipts and unchanged snapshot are still required.
create or replace function public.upload_delivery_context(p_owner uuid,p_workflow uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('workflowId',w.id,'expiresAt',w.expires_at,'albumId',a.id,'albumTitle',a.title,'preset',a.qr_preset_id,
 'savedBatchId',(select b.batch_id from videoalbum_private.workflow_downloads b where b.workflow_id=w.id
   and b.links and (b.qr_count=0 or (b.sheet and b.individual))
   and b.snapshot=videoalbum_private.download_snapshot(w.id)),
 'jobs',(select coalesce(jsonb_agg(jsonb_build_object('jobId',j.id,'videoId',j.video_id,'caption',v.caption,
   'state',j.state,'processing',j.processing_status,'visibility',j.effective_visibility,'requestedVisibility',j.requested_visibility,
   'verifiedAt',j.verified_at,'qrEligible',exists(select 1 from public.qr_ready_uploads r where r.id=j.id)) order by v.sort_order,j.id),'[]'::jsonb)
   from public.upload_jobs j join public.videos v on v.id=j.video_id and v.owner_id=j.owner_id where j.workflow_id=w.id))
 from public.upload_workflows w join public.albums a on a.id=w.album_id and a.owner_id=w.owner_id
 join lateral public.channel_library_context(p_owner,p_workflow) c on true
 where w.id=p_workflow and w.owner_id=p_owner and w.expires_at>statement_timestamp()
$$;

create or replace function public.complete_upload_delivery(p_owner uuid,p_workflow uuid,p_batch uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare b videoalbum_private.workflow_downloads;
begin
 perform 1 from auth.users where id=p_owner for update;
 perform 1 from public.upload_workflows where id=p_workflow and owner_id=p_owner for update;
 if not found or public.upload_delivery_context(p_owner,p_workflow) is null then return false; end if;
 select * into b from videoalbum_private.workflow_downloads where workflow_id=p_workflow and batch_id=p_batch for update;
 if not found or not b.links or (b.qr_count>0 and (not b.sheet or not b.individual)) or
  b.snapshot is distinct from videoalbum_private.download_snapshot(p_workflow) then return false; end if;
 update videoalbum_private.upload_idempotency set terminal_state='purged' where workflow_id=p_workflow and owner_id=p_owner;
 delete from public.upload_workflows where id=p_workflow and owner_id=p_owner;
 return found;
end $$;
