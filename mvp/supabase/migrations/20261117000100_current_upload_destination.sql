-- A cached ready job cannot supersede a newer pending job for the same app entry.
create function public.current_upload_destination(p_owner uuid,p_job uuid,p_video uuid,p_workflow uuid)
returns text language sql stable security definer set search_path='' as $$
 select 'https://www.youtube.com/watch?v='||r.provider_video_id
 from public.video_library v join public.qr_ready_uploads r on r.id=v.job_id and r.owner_id=v.owner_id
 join lateral public.channel_library_context(p_owner,p_workflow) c on true
 where v.owner_id=p_owner and v.id=p_video and v.job_id=p_job and v.workflow_id=p_workflow
$$;
revoke all on function public.current_upload_destination(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.current_upload_destination(uuid,uuid,uuid,uuid) to service_role;
