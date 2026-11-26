-- MVP eligibility is based on trusted provider metadata, not a browser/player attestation.
-- Preserve the view's shape, RLS and every processing/visibility/freshness condition.
create or replace view public.qr_ready_uploads with (security_invoker=true) as
select j.id,j.owner_id,j.workflow_id,j.video_id,j.provider_video_id,j.effective_visibility,j.verified_at
from public.upload_jobs j join public.upload_workflows w on w.id=j.workflow_id and w.owner_id=j.owner_id
where w.expires_at>statement_timestamp() and j.state='uploaded' and j.processing_status='succeeded'
 and j.channel_verified and j.verified_at>statement_timestamp()-interval '5 minutes'
 and j.provider_video_id is not null
 and j.effective_visibility=j.requested_visibility and j.effective_visibility in ('public','unlisted')
 and (j.effective_visibility<>'public' or j.public_confirmed_at is not null)
 and j.verified_size_bytes between 1 and 1073741824 and j.verified_duration_seconds>0 and j.verified_duration_seconds<=600;

-- Retire the old worker protocol safely. An old Edge deployment or in-flight worker must not
-- queue work, receive provider IDs or mutate a job/download snapshot after this migration.
-- Keep signatures and historical columns to avoid breaking generated API types or receipts.
create or replace function public.request_upload_playback(p_owner uuid,p_job uuid) returns boolean
language sql security definer set search_path='' as $$ select false $$;
create or replace function public.claim_upload_playback(p_claim uuid) returns jsonb
language sql security definer set search_path='' as $$ select null::jsonb $$;
create or replace function public.finish_upload_playback(p_claim uuid,p_passed boolean) returns boolean
language sql security definer set search_path='' as $$ select false $$;
delete from videoalbum_private.playback_checks;

revoke all on function public.request_upload_playback(uuid,uuid),public.claim_upload_playback(uuid),
 public.finish_upload_playback(uuid,boolean) from public,anon,authenticated;
grant execute on function public.request_upload_playback(uuid,uuid),public.claim_upload_playback(uuid),
 public.finish_upload_playback(uuid,boolean) to service_role;
