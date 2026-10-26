begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id) values
 ('00000000-0000-4000-8000-000000000071'), ('00000000-0000-4000-8000-000000000072');
insert into public.profiles(owner_id) values
 ('00000000-0000-4000-8000-000000000071'), ('00000000-0000-4000-8000-000000000072');
insert into public.albums(id,owner_id,title) values
 ('10000000-0000-4000-8000-000000000071','00000000-0000-4000-8000-000000000071','Synthetic A'),
 ('10000000-0000-4000-8000-000000000072','00000000-0000-4000-8000-000000000072','Synthetic B');
insert into public.videos(id,owner_id,album_id,caption) values
 ('20000000-0000-4000-8000-000000000071','00000000-0000-4000-8000-000000000071','10000000-0000-4000-8000-000000000071','Synthetic lasting caption'),
 ('20000000-0000-4000-8000-000000000072','00000000-0000-4000-8000-000000000072','10000000-0000-4000-8000-000000000072','Synthetic B'),
 ('20000000-0000-4000-8000-000000000073','00000000-0000-4000-8000-000000000071','10000000-0000-4000-8000-000000000071','Synthetic placeholder');
insert into public.upload_workflows(id,owner_id,album_id) values
 ('30000000-0000-4000-8000-000000000071','00000000-0000-4000-8000-000000000071','10000000-0000-4000-8000-000000000071'),
 ('30000000-0000-4000-8000-000000000072','00000000-0000-4000-8000-000000000072','10000000-0000-4000-8000-000000000072');
insert into public.upload_jobs(id,owner_id,workflow_id,album_id,video_id,idempotency_key,upload_title,
 state,provider_video_id,effective_visibility,processing_status,verified_at,channel_verified,
 anonymous_playback_verified_at,verified_size_bytes,verified_duration_seconds) values
 ('40000000-0000-4000-8000-000000000071','00000000-0000-4000-8000-000000000071','30000000-0000-4000-8000-000000000071',
 '10000000-0000-4000-8000-000000000071','20000000-0000-4000-8000-000000000071',gen_random_uuid(),'Synthetic',
 'uploaded','synthetic01','unlisted','succeeded',now(),true,now(),1024,1);

select ok((select reloptions @> array['security_invoker=true'] from pg_class where oid='public.video_library'::regclass),'joined library runs underlying RLS as caller');
select ok(not has_table_privilege('anon','public.video_library','select'),'anonymous library denied');
select ok(not has_table_privilege('authenticated','public.video_library','insert,update,delete'),'joined library is read only');
set local role authenticated;
set local request.jwt.claim.sub='00000000-0000-4000-8000-000000000071';
select is((select count(*)::int from public.video_library),2,'A sees own ready entry and placeholder only');
select is((select count(*)::int from public.video_library where owner_id='00000000-0000-4000-8000-000000000072'),0,'joined view cannot bypass B ownership');
select is((select provider_video_id from public.video_library where id='20000000-0000-4000-8000-000000000071'),'synthetic01','eligible job includes temporary deduplication ID');
select ok((select qr_ready from public.video_library where id='20000000-0000-4000-8000-000000000071'),'trusted readiness is preserved by joined view');
select ok((select job_id is null and not qr_ready from public.video_library where id='20000000-0000-4000-8000-000000000073'),'left join retains entry without upload');
reset role;
insert into public.upload_jobs(id,owner_id,workflow_id,album_id,video_id,idempotency_key,upload_title,created_at)
 values ('40000000-0000-4000-8000-000000000073','00000000-0000-4000-8000-000000000071','30000000-0000-4000-8000-000000000071',
 '10000000-0000-4000-8000-000000000071','20000000-0000-4000-8000-000000000071',gen_random_uuid(),'Synthetic newer pending',now()+interval '1 second');
set local role authenticated;
select ok((select job_id='40000000-0000-4000-8000-000000000073' and not qr_ready and provider_video_id is null
 from public.video_library where id='20000000-0000-4000-8000-000000000071'),'newer pending job cannot fall back to older ready upload');
reset role;
select public.finish_upload_workflow('00000000-0000-4000-8000-000000000071','30000000-0000-4000-8000-000000000071');
set local role authenticated;
select ok((select caption='Synthetic lasting caption' and job_id is null and workflow_expires_at is null
 and provider_video_id is null and not qr_ready from public.video_library where id='20000000-0000-4000-8000-000000000071'),
 'cleanup preserves caption without temporary provider/job/expiry fields');
reset role;
update public.profiles set deletion_requested_at=now() where owner_id='00000000-0000-4000-8000-000000000071';
set local role authenticated;
select is((select count(*)::int from public.video_library),0,'deletion marker immediately hides joined rows');
set local request.jwt.claim.sub='00000000-0000-4000-8000-000000000072';
select is((select count(*)::int from public.video_library),1,'A cleanup and deletion leave B library intact');
reset role;
select * from finish();
rollback;
