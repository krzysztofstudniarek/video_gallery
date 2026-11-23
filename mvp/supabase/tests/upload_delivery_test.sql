begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id) values('00000000-0000-4000-8000-000000000061'),('00000000-0000-4000-8000-000000000062');
insert into public.profiles(owner_id) values('00000000-0000-4000-8000-000000000061'),('00000000-0000-4000-8000-000000000062');
select public.start_youtube_workflow('00000000-0000-4000-8000-000000000061',repeat('a',64),'cipher','test','10000000-0000-4000-8000-000000000061');
select public.save_youtube_workflow('00000000-0000-4000-8000-000000000061','10000000-0000-4000-8000-000000000061','cipher','test','synthetic-channel','Synthetic');
create temporary table fixture as select '00000000-0000-4000-8000-000000000061'::uuid owner_id,
 '10000000-0000-4000-8000-000000000061'::uuid workflow_id,
 public.create_upload_job('00000000-0000-4000-8000-000000000061','10000000-0000-4000-8000-000000000061',
 '20000000-0000-4000-8000-000000000061','Title','','Caption','unlisted',false,1024,repeat('a',64),false) job_id;
select ok(not has_function_privilege(r,p.oid,'execute'),p.proname||' denies '||r)
from pg_proc p join pg_namespace n on n.oid=p.pronamespace,unnest(array['anon','authenticated']) r
where n.nspname='public' and p.proname in ('request_upload_playback','claim_upload_playback','finish_upload_playback',
 'upload_delivery_context','prepare_upload_downloads','acknowledge_upload_download','complete_upload_delivery','upload_delivery_receipt');
select ok(public.upload_delivery_context('00000000-0000-4000-8000-000000000062',workflow_id) is null,'delivery cannot cross owners') from fixture;
select throws_ok($$select public.prepare_upload_downloads(owner_id,workflow_id) from fixture$$,'23514',null,'unprocessed job cannot export');
update public.upload_jobs set state='uploaded',provider_video_id='synthetic61',effective_visibility='unlisted',
 processing_status='succeeded',channel_verified=true,verified_size_bytes=1024,verified_duration_seconds=1,verified_at=clock_timestamp();
select throws_ok($$select public.prepare_upload_downloads(owner_id,workflow_id) from fixture$$,'23514',null,'owner metadata does not prove anonymous playback');
select ok(public.request_upload_playback(owner_id,job_id),'preprint queues trusted playback') from fixture;
select ok(public.claim_upload_playback('30000000-0000-4000-8000-000000000061') is not null,'worker claims bounded playback');
select ok(not public.finish_upload_playback('30000000-0000-4000-8000-000000000062',true),'unknown worker claim cannot attest');
update public.upload_jobs set verified_at=clock_timestamp();
select ok(not public.finish_upload_playback('30000000-0000-4000-8000-000000000061',true),'stale playback cannot attest a changed verification');
select ok(public.request_upload_playback(owner_id,job_id),'new verification queues safely') from fixture;
select ok(public.claim_upload_playback('30000000-0000-4000-8000-000000000062') is not null,'new worker claim');
select ok(public.finish_upload_playback('30000000-0000-4000-8000-000000000062',false),'failed playback recorded');
select is((select count(*)::int from public.qr_ready_uploads),0,'failed playback blocks QR');
select public.request_upload_playback(owner_id,job_id) from fixture;
select public.claim_upload_playback('30000000-0000-4000-8000-000000000063');
select ok(public.finish_upload_playback('30000000-0000-4000-8000-000000000063',true),'trusted anonymous playback succeeds');
select is((select count(*)::int from public.qr_ready_uploads),1,'fresh trusted evidence enables QR');
select is(public.current_upload_destination(owner_id,job_id,(select video_id from public.upload_jobs where id=job_id),workflow_id),
 'https://www.youtube.com/watch?v=synthetic61','current verified job resolves directly') from fixture;
select ok(not has_function_privilege('authenticated','public.current_upload_destination(uuid,uuid,uuid,uuid)','execute'),'destination lookup is backend-only');
insert into public.upload_jobs(id,owner_id,workflow_id,album_id,video_id,idempotency_key,upload_title,created_at)
 select '40000000-0000-4000-8000-000000000061',owner_id,workflow_id,album_id,video_id,gen_random_uuid(),'Pending replacement',clock_timestamp()+interval '1 second'
 from public.upload_jobs where id=(select job_id from fixture);
select ok(public.current_upload_destination(owner_id,job_id,(select video_id from public.upload_jobs where id=job_id),workflow_id) is null,
 'newer pending job blocks cached ready destination') from fixture;
delete from public.upload_jobs where id='40000000-0000-4000-8000-000000000061';
create temporary table batch as select public.prepare_upload_downloads(owner_id,workflow_id) payload from fixture;
select is((select payload->'entries'->0->>'destination' from batch),'https://www.youtube.com/watch?v=synthetic61','handoff uses canonical direct watch URL');
select ok(not public.complete_upload_delivery(owner_id,workflow_id,(select (payload->>'batchId')::uuid from batch)),'cannot finish before downloads') from fixture;
select ok(public.acknowledge_upload_download(owner_id,workflow_id,(select (payload->>'batchId')::uuid from batch),'links'),'links receipt') from fixture;
select ok(not public.complete_upload_delivery(owner_id,workflow_id,(select (payload->>'batchId')::uuid from batch)),'links alone cannot purge QR workflow') from fixture;
select public.acknowledge_upload_download(owner_id,workflow_id,(select (payload->>'batchId')::uuid from batch),'sheet') from fixture;
select public.acknowledge_upload_download(owner_id,workflow_id,(select (payload->>'batchId')::uuid from batch),'individual') from fixture;
update public.videos set caption='Changed caption';
select ok(not public.complete_upload_delivery(owner_id,workflow_id,(select (payload->>'batchId')::uuid from batch)),'changed caption invalidates downloaded snapshot') from fixture;
update batch set payload=(select public.prepare_upload_downloads(owner_id,workflow_id) from fixture);
update videoalbum_private.workflow_downloads set expires_at=clock_timestamp()-interval '1 second';
select ok(not public.acknowledge_upload_download(owner_id,workflow_id,(select (payload->>'batchId')::uuid from batch),'links'),'expired batch cannot acknowledge') from fixture;
update batch set payload=(select public.prepare_upload_downloads(owner_id,workflow_id) from fixture);
select public.acknowledge_upload_download(owner_id,workflow_id,(select (payload->>'batchId')::uuid from batch),kind)
 from fixture,unnest(array['sheet','individual','links']) kind;
select ok(public.complete_upload_delivery(owner_id,workflow_id,(select (payload->>'batchId')::uuid from batch)),'explicit completion after all receipts purges workflow') from fixture;
select is((select count(*)::int from public.upload_jobs),0,'temporary jobs purged');
select is((select count(*)::int from videoalbum_private.workflow_credentials),0,'temporary credentials purged');
select is((select count(*)::int from videoalbum_private.playback_checks),0,'playback queue purged');
select is((select count(*)::int from videoalbum_private.workflow_downloads),0,'download state purged');
select is((select caption from public.videos),'Changed caption','independent app caption persists');
select ok(public.upload_delivery_receipt(owner_id,workflow_id),'finished bookmark has provider-free receipt') from fixture;
select ok(not public.upload_delivery_receipt('00000000-0000-4000-8000-000000000062',workflow_id),'finished receipt owner isolation') from fixture;
select throws_ok($$select public.prepare_upload_downloads(owner_id,workflow_id) from fixture$$,'42501',null,'completed workflow cannot regenerate codes');
select * from finish();
rollback;
