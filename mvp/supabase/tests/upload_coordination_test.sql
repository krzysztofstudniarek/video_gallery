begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id) values
 ('00000000-0000-4000-8000-000000000051'),('00000000-0000-4000-8000-000000000052');
insert into public.profiles(owner_id) select id from auth.users where id::text like '%00000000005_';
select public.start_youtube_workflow('00000000-0000-4000-8000-000000000051',repeat('a',64),'cipher','test','10000000-0000-4000-8000-000000000051');
select public.start_youtube_workflow('00000000-0000-4000-8000-000000000052',repeat('b',64),'cipher','test','10000000-0000-4000-8000-000000000052');
select public.save_youtube_workflow('00000000-0000-4000-8000-000000000051','10000000-0000-4000-8000-000000000051','cipher','test','synthetic-channel','Synthetic');
select public.save_youtube_workflow('00000000-0000-4000-8000-000000000052','10000000-0000-4000-8000-000000000052','cipher','test','synthetic-channel-b','Synthetic');

select ok(not has_function_privilege(r,p.oid,'execute'),p.proname||' denies '||r)
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace,unnest(array['anon','authenticated']) r
 where n.nspname='public' and p.proname in ('create_upload_job','upload_job_context','claim_upload_dispatch',
 'save_upload_session','upload_transfer_permit','upload_poll_claim','record_upload_result','cancel_upload_job');
select ok(not has_table_privilege('authenticated','videoalbum_private.'||t,'select,insert,update,delete'),t||' is private')
 from unnest(array['upload_controls','upload_daily']) t;
select throws_ok($$select public.create_upload_job('00000000-0000-4000-8000-000000000052','10000000-0000-4000-8000-000000000051',gen_random_uuid(),'Title','','','unlisted',false,1024,repeat('a',64),false)$$,'42501',null,'foreign workflow cannot create upload');
select throws_ok($$select public.create_upload_job('00000000-0000-4000-8000-000000000051','10000000-0000-4000-8000-000000000051',gen_random_uuid(),'Title','','','public',false,1024,repeat('a',64),false)$$,'23514',null,'Public needs explicit per-upload confirmation');
select throws_ok($$select public.create_upload_job('00000000-0000-4000-8000-000000000051','10000000-0000-4000-8000-000000000051',gen_random_uuid(),'Title',repeat('é',2501),'','unlisted',false,1024,repeat('a',64),false)$$,'23514',null,'description bounded by UTF-8 bytes');
select throws_ok($$select public.create_upload_job('00000000-0000-4000-8000-000000000051','10000000-0000-4000-8000-000000000051',gen_random_uuid(),'Title','','','unlisted',false,1073741825,repeat('a',64),false)$$,'23514',null,'declared size bounded');
create temporary table test_uploads(owner_id uuid,job_id uuid);
insert into test_uploads values('00000000-0000-4000-8000-000000000051',public.create_upload_job(
 '00000000-0000-4000-8000-000000000051','10000000-0000-4000-8000-000000000051',
 '20000000-0000-4000-8000-000000000051','Authored title','Authored description','Independent caption','public',true,1024,repeat('a',64),false));
insert into test_uploads values('00000000-0000-4000-8000-000000000052',public.create_upload_job(
 '00000000-0000-4000-8000-000000000052','10000000-0000-4000-8000-000000000052',
 '20000000-0000-4000-8000-000000000052','Title B','','','unlisted',false,1024,repeat('b',64),false));
select is(public.create_upload_job('00000000-0000-4000-8000-000000000051','10000000-0000-4000-8000-000000000051',
 '20000000-0000-4000-8000-000000000051','Authored title','Authored description','Independent caption','public',true,1024,repeat('a',64),false),
 (select job_id from test_uploads where owner_id='00000000-0000-4000-8000-000000000051'),'same request returns same job');
select is((select count(*)::int from public.videos where owner_id='00000000-0000-4000-8000-000000000051'),1,'idempotent retry reserves one durable entry');
select ok((select public_confirmed_at is not null from public.upload_jobs where owner_id='00000000-0000-4000-8000-000000000051'),'authenticated Public evidence persisted');
select throws_ok($$select public.create_upload_job('00000000-0000-4000-8000-000000000051','10000000-0000-4000-8000-000000000051','20000000-0000-4000-8000-000000000051','Changed','','','unlisted',false,1024,repeat('a',64),false)$$,'23505',null,'idempotency key cannot change request');
select ok(public.upload_job_context('00000000-0000-4000-8000-000000000052',(select job_id from test_uploads where owner_id='00000000-0000-4000-8000-000000000051')) is null,'job context checks owner');
select is(public.claim_upload_dispatch(owner_id,job_id,'30000000-0000-4000-8000-000000000051'),'claimed','one-use dispatch claim') from test_uploads where owner_id='00000000-0000-4000-8000-000000000051';
select is(public.claim_upload_dispatch(owner_id,job_id,'30000000-0000-4000-8000-000000000051'),'reconcile_existing_job','ambiguous claim is not dispatched again') from test_uploads where owner_id='00000000-0000-4000-8000-000000000051';
select is((select attempts from videoalbum_private.upload_daily where bucket='project'),1,'dispatched/ambiguous attempt counts');
select ok(not public.save_upload_session(owner_id,job_id,'30000000-0000-4000-8000-000000000052','cipher','test'),'wrong transfer lease denied') from test_uploads where owner_id='00000000-0000-4000-8000-000000000051';
select ok(public.save_upload_session(owner_id,job_id,'30000000-0000-4000-8000-000000000051','encrypted-session','test'),'session stored privately') from test_uploads where owner_id='00000000-0000-4000-8000-000000000051';
select ok((select s.expires_at=w.expires_at from videoalbum_private.upload_sessions s join public.upload_workflows w on w.id=s.workflow_id),'session cannot extend original workflow');
select ok(not public.upload_transfer_permit(owner_id,job_id,'30000000-0000-4000-8000-000000000052',true),'second tab cannot steal live lease') from test_uploads where owner_id='00000000-0000-4000-8000-000000000051';
update videoalbum_private.upload_controls set lease_until=clock_timestamp()-interval '1 second';
select ok(not public.upload_transfer_permit(owner_id,job_id,'30000000-0000-4000-8000-000000000051',false),'expired transfer must reacquire') from test_uploads where owner_id='00000000-0000-4000-8000-000000000051';
select ok(public.upload_transfer_permit(owner_id,job_id,'30000000-0000-4000-8000-000000000052',true),'resume reuses existing session after lease timeout') from test_uploads where owner_id='00000000-0000-4000-8000-000000000051';
select is((select attempts from videoalbum_private.upload_daily where bucket='project'),1,'resume consumes no new initiation');
select ok(public.upload_poll_claim(owner_id,job_id),'first reconciliation allowed') from test_uploads where owner_id='00000000-0000-4000-8000-000000000051';
select ok(not public.upload_poll_claim(owner_id,job_id),'immediate repeated polling denied') from test_uploads where owner_id='00000000-0000-4000-8000-000000000051';
update videoalbum_private.upload_controls set poll_count=120,next_poll_at=null;
select ok(not public.upload_poll_claim(owner_id,job_id),'poll budget survives refresh') from test_uploads where owner_id='00000000-0000-4000-8000-000000000051';
select ok(public.record_upload_result(owner_id,job_id,'synthetic51','public','succeeded',true,1024,1,null),'trusted result recorded') from test_uploads where owner_id='00000000-0000-4000-8000-000000000051';
select is((select count(*)::int from videoalbum_private.upload_sessions),0,'completed transfer session erased');
select is((select count(*)::int from public.qr_ready_uploads),0,'metadata verification alone cannot stand in for anonymous playback');
update videoalbum_private.upload_daily set attempts=60 where bucket='project';
select is(public.claim_upload_dispatch(owner_id,job_id,'30000000-0000-4000-8000-000000000052'),'project_daily_quota','project Pacific-day budget enforced') from test_uploads where owner_id='00000000-0000-4000-8000-000000000052';
update videoalbum_private.upload_daily set attempts=1 where bucket='project';
update videoalbum_private.upload_daily set attempts=20 where bucket='00000000-0000-4000-8000-000000000052';
select is(public.claim_upload_dispatch(owner_id,job_id,'30000000-0000-4000-8000-000000000052'),'account_daily_quota','account Pacific-day budget enforced') from test_uploads where owner_id='00000000-0000-4000-8000-000000000052';
select ok(public.cancel_upload_job(owner_id,job_id),'cancel removes temporary job') from test_uploads where owner_id='00000000-0000-4000-8000-000000000051';
select is((select caption from public.videos where owner_id='00000000-0000-4000-8000-000000000051'),'Independent caption','cancel preserves independently authored caption');
select is((select attempts from videoalbum_private.upload_daily where bucket='project'),1,'cancel does not reset quota');
select throws_ok($$select public.create_upload_job('00000000-0000-4000-8000-000000000051','10000000-0000-4000-8000-000000000051','20000000-0000-4000-8000-000000000051','Authored title','Authored description','Independent caption','public',true,1024,repeat('a',64),false)$$,'23505',null,'cancelled request cannot recreate upload');
-- Capacity guards also apply to direct authenticated inserts, under the same account lock.
insert into public.albums(owner_id,title) select '00000000-0000-4000-8000-000000000051','Synthetic' from generate_series(1,4);
select throws_ok($$insert into public.albums(owner_id,title) values('00000000-0000-4000-8000-000000000051','Excess')$$,'23514',null,'five albums/account enforced');
insert into public.videos(owner_id,album_id) select '00000000-0000-4000-8000-000000000051',w.album_id
 from public.upload_workflows w,generate_series(1,49) where w.owner_id='00000000-0000-4000-8000-000000000051';
select throws_ok($$insert into public.videos(owner_id,album_id) select owner_id,album_id from public.upload_workflows where owner_id='00000000-0000-4000-8000-000000000051'$$,'23514',null,'50 videos/album enforced');
select public.disconnect_youtube_workflows('00000000-0000-4000-8000-000000000052');
select ok(public.upload_job_context('00000000-0000-4000-8000-000000000052',(select job_id from test_uploads where owner_id='00000000-0000-4000-8000-000000000052')) is null,'disconnect removes upload capabilities');
select is((select count(*)::int from videoalbum_private.upload_controls),0,'disconnect/cancel erase original-file fingerprints too');
select * from finish();
rollback;
