-- One request/snapshot for the library, with the caller's RLS on every underlying relation.
-- Keep entries with no live job; temporary provider fields disappear with workflow cleanup.
create view public.video_library with (security_invoker = true) as
select v.id, v.owner_id, v.caption, v.sort_order as video_sort_order,
  a.id as album_id, a.title as album_title, a.sort_order as album_sort_order,
  j.id as job_id, j.workflow_id, w.expires_at as workflow_expires_at,
  j.state as job_state, j.processing_status, j.verified_at, j.effective_visibility,
  (r.id is not null) as qr_ready, r.effective_visibility as qr_visibility,
  r.provider_video_id
from public.videos v
join public.albums a on a.id = v.album_id and a.owner_id = v.owner_id
left join lateral (
  select job.* from public.upload_jobs job
  where job.video_id = v.id and job.album_id = v.album_id and job.owner_id = v.owner_id
  order by job.created_at desc, job.id desc limit 1
) j on true
left join public.upload_workflows w on w.id = j.workflow_id and w.owner_id = v.owner_id
left join public.qr_ready_uploads r on r.id = j.id and r.owner_id = v.owner_id;
revoke all on public.video_library from public, anon, authenticated;
grant select on public.video_library to authenticated, service_role;
