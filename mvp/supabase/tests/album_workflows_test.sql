begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
select ok(to_regclass('public.feedback') is null, 'no in-app feedback storage');
insert into auth.users(id) values
 ('00000000-0000-4000-8000-000000000021'), ('00000000-0000-4000-8000-000000000022');
insert into public.profiles(owner_id, display_name) values
 ('00000000-0000-4000-8000-000000000021', 'A'), ('00000000-0000-4000-8000-000000000022', 'B');
insert into public.albums(id, owner_id, title) values
 ('10000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000021','A'),
 ('10000000-0000-4000-8000-000000000022','00000000-0000-4000-8000-000000000022','B');
insert into public.videos(id, owner_id, album_id, caption) select
 ('20000000-0000-4000-8000-' || right(id::text,12))::uuid, owner_id, id, title from public.albums;
insert into public.upload_workflows(id, owner_id, album_id) select
 ('30000000-0000-4000-8000-' || right(id::text,12))::uuid, owner_id, id from public.albums;
insert into public.youtube_connections(workflow_id, owner_id, channel_id, channel_title, verified_at)
 select id, owner_id, 'synthetic-channel', 'Synthetic', now() from public.upload_workflows;
insert into videoalbum_private.workflow_credentials(workflow_id, owner_id, refresh_cipher, key_id)
 select id, owner_id, 'synthetic-envelope', 'test-v1' from public.upload_workflows;

-- All production relations and capabilities deny anonymous access; no forgotten default grants.
select ok(c.relrowsecurity, c.relname || ' has RLS') from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname in ('public','videoalbum_private') and c.relkind='r' and c.relname in
 ('profiles','albums','videos','upload_workflows','upload_jobs','youtube_connections',
 'workflow_credentials','upload_sessions','oauth_states','upload_idempotency','deletion_ledger');
select ok(not has_table_privilege('anon', 'public.' || t, 'select,insert,update,delete'), t || ' denies anon')
 from unnest(array['profiles','albums','videos','upload_workflows','upload_jobs','youtube_connections','qr_ready_uploads']) t;
select ok(not has_schema_privilege('authenticated','videoalbum_private','usage'), 'owner cannot enter private schema');
select ok(not has_table_privilege('authenticated','videoalbum_private.' || t,'select,insert,update,delete'), t || ' denies frontend')
 from unnest(array['workflow_credentials','upload_sessions','oauth_states','upload_idempotency','deletion_ledger']) t;
select ok(not has_function_privilege('anon', p.oid, 'execute'), p.proname || ' denies anon')
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
 and p.proname in ('request_upload','consume_upload_oauth','finish_upload_workflow','purge_expired_upload_data');
select ok(not has_function_privilege('authenticated', p.oid, 'execute'), p.proname || ' denies user')
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
 and p.proname in ('consume_upload_oauth','finish_upload_workflow','purge_expired_upload_data');
select ok(p.proconfig @> array['search_path=""'], p.proname || ' pins search_path')
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='videoalbum_private'
 or (n.nspname='public' and p.proname in ('request_upload','consume_upload_oauth','finish_upload_workflow','purge_expired_upload_data'));

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000021';
select is((select count(*)::int from public.profiles),1,'A sees only own profile');
select is((select count(*)::int from public.albums),1,'A sees only own album');
select is((select count(*)::int from public.videos),1,'A sees only own video');
select is((select count(*)::int from public.upload_workflows),1,'A sees only own live workflow');
select is((select count(*)::int from public.youtube_connections),1,'A sees only own connection');
select throws_ok($$insert into public.albums(owner_id,title) values ('00000000-0000-4000-8000-000000000022','forged')$$,'42501',null,'forged album owner denied');
select throws_ok($$insert into public.videos(album_id) values ('10000000-0000-4000-8000-000000000022')$$,'42501',null,'video checks parent ownership');
select throws_ok($$insert into public.upload_workflows(album_id) values ('10000000-0000-4000-8000-000000000022')$$,'42501',null,'workflow checks parent ownership');
select throws_ok($$update public.albums set owner_id='00000000-0000-4000-8000-000000000022'$$,'42501',null,'owner changes denied');
select throws_ok($$update public.videos set album_id='10000000-0000-4000-8000-000000000022'$$,'42501',null,'parent changes denied');
select throws_ok($$update public.upload_workflows set expires_at=now()+interval '30 days'$$,'42501',null,'client cannot extend expiry');
select throws_ok($$update public.profiles set deletion_requested_at=now()$$,'42501',null,'client cannot forge deletion status');
select throws_ok($$insert into public.albums(title,qr_preset_id) values ('bad preset',5)$$,'23514',null,'only four QR presets');
select throws_ok($$select public.request_upload('30000000-0000-4000-8000-000000000022','20000000-0000-4000-8000-000000000022',gen_random_uuid(),'Synthetic')$$,'42501',null,'RPC rejects another owner');
select throws_ok($$select public.request_upload('30000000-0000-4000-8000-000000000021','20000000-0000-4000-8000-000000000022',gen_random_uuid(),'Synthetic')$$,'42501',null,'RPC rejects foreign video');
select throws_ok($$select public.request_upload('30000000-0000-4000-8000-000000000021','20000000-0000-4000-8000-000000000021',gen_random_uuid(),'Synthetic','public')$$,'23514',null,'Public requires explicit confirmation');
select lives_ok($$select public.request_upload('30000000-0000-4000-8000-000000000021','20000000-0000-4000-8000-000000000021','40000000-0000-4000-8000-000000000021','Synthetic')$$,'default Unlisted request');
select lives_ok($$select public.request_upload('30000000-0000-4000-8000-000000000021','20000000-0000-4000-8000-000000000021','40000000-0000-4000-8000-000000000021','Synthetic')$$,'same request idempotent');
select is((select count(*)::int from public.upload_jobs),1,'no duplicate job');
select is((select requested_visibility from public.upload_jobs),'unlisted','Unlisted default');
select throws_ok($$select public.request_upload('30000000-0000-4000-8000-000000000021','20000000-0000-4000-8000-000000000021','40000000-0000-4000-8000-000000000021','Changed')$$,'23505',null,'changed retry rejected');
select lives_ok($$select public.request_upload('30000000-0000-4000-8000-000000000021','20000000-0000-4000-8000-000000000021','50000000-0000-4000-8000-000000000021','Synthetic','public',true)$$,'confirmed Public request');
select lives_ok($$select public.request_upload('30000000-0000-4000-8000-000000000021','20000000-0000-4000-8000-000000000021','60000000-0000-4000-8000-000000000021','Synthetic','private')$$,'Private supported');
select ok((select public_confirmed_at is not null from public.upload_jobs where requested_visibility='public'),'confirmation timestamp server-recorded');
select throws_ok($$update public.upload_jobs set effective_visibility='unlisted',processing_status='succeeded',verified_at=now()$$,'42501',null,'owner cannot forge verification');
select throws_ok($$update public.upload_jobs set state='uploaded'$$,'42501',null,'owner cannot forge transfer status');
select throws_ok($$update public.upload_jobs set public_confirmed_at=now()$$,'42501',null,'owner cannot forge confirmation timestamp');
select throws_ok($$insert into public.youtube_connections(workflow_id,owner_id,channel_id,channel_title,verified_at) values (gen_random_uuid(),auth.uid(),'synthetic','Synthetic',now())$$,'42501',null,'owner cannot forge connection');
select is((select count(*)::int from public.qr_ready_uploads),0,'unverified jobs ineligible');
with changed as (update public.albums set title='forged' where title='B' returning id)
 select is((select count(*)::int from changed),0,'A cannot update B');
with removed as (delete from public.videos where caption='B' returning id)
 select is((select count(*)::int from removed),0,'A cannot delete B child');
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000022';
select is((select count(*)::int from public.upload_jobs),0,'B cannot see A jobs');
select is((select display_name from public.profiles),'B','B sees own profile');
select is((select title from public.albums),'B','B sees own album');
select is((select caption from public.videos),'B','B sees own entry');
select is((select count(*)::int from public.youtube_connections),1,'B sees own connection');
reset role;

-- Trusted verification must satisfy every evidence condition and requested visibility.
update public.upload_jobs set state='uploaded',provider_video_id='synthetic01',effective_visibility=requested_visibility,
 processing_status='succeeded',verified_at=now(),anonymous_playback_verified_at=now(),channel_verified=true,
 verified_size_bytes=1024,verified_duration_seconds=1;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000021';
select is((select count(*)::int from public.qr_ready_uploads),2,'verified Public/Unlisted eligible; Private excluded');
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000022';
select is((select count(*)::int from public.qr_ready_uploads),0,'view respects caller RLS');
reset role;
update public.upload_jobs set effective_visibility='private' where requested_visibility='unlisted';
select is((select count(*)::int from public.qr_ready_uploads),1,'visibility mismatch ineligible');
update public.upload_jobs set channel_verified=false;
select is((select count(*)::int from public.qr_ready_uploads),0,'wrong channel ineligible');
update public.upload_jobs set channel_verified=true,processing_status='processing';
select is((select count(*)::int from public.qr_ready_uploads),0,'processing ineligible');
update public.upload_jobs set processing_status='succeeded',anonymous_playback_verified_at=null;
select is((select count(*)::int from public.qr_ready_uploads),0,'anonymous playback evidence required');
update public.upload_jobs set anonymous_playback_verified_at=now(),verified_size_bytes=1073741825;
select is((select count(*)::int from public.qr_ready_uploads),0,'oversized media ineligible');
update public.upload_jobs set verified_size_bytes=1024,verified_duration_seconds=601;
select is((select count(*)::int from public.qr_ready_uploads),0,'overlong media ineligible');
select throws_ok($$update public.upload_jobs set requested_visibility='unlisted',public_confirmed_at=null where requested_visibility='public'$$,'23514',null,'worker cannot reuse request/confirmation');
select throws_ok($$update public.upload_workflows set expires_at=expires_at+interval '1 second'$$,'23514',null,'worker cannot extend workflow');

-- OAuth is atomic, owner-bound, one use, and has a fixed ten-minute maximum.
insert into videoalbum_private.oauth_states(state_hash,workflow_id,owner_id,verifier_cipher,key_id)
 values(repeat('a',64),'30000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000021','synthetic-envelope','test-v1');
select ok((select expires_at <= created_at+interval '10 minutes' from videoalbum_private.oauth_states),'OAuth ten-minute cap');
select throws_ok($$update videoalbum_private.oauth_states set expires_at=expires_at+interval '1 minute'$$,'23514',null,'OAuth cannot extend');
set local role service_role;
select is((select count(*)::int from public.consume_upload_oauth('00000000-0000-4000-8000-000000000022','30000000-0000-4000-8000-000000000021',repeat('a',64))),0,'wrong owner cannot consume state');
select is((select count(*)::int from public.consume_upload_oauth('00000000-0000-4000-8000-000000000021','30000000-0000-4000-8000-000000000021',repeat('a',64))),1,'state consumed');
select is((select count(*)::int from public.consume_upload_oauth('00000000-0000-4000-8000-000000000021','30000000-0000-4000-8000-000000000021',repeat('a',64))),0,'state cannot replay');
reset role;
update public.upload_jobs set state='transferring' where requested_visibility='unlisted';
insert into videoalbum_private.upload_sessions(job_id,workflow_id,owner_id,session_cipher,key_id,expires_at)
 select id,workflow_id,owner_id,'synthetic-envelope','test-v1',now()+interval '1 hour'
 from public.upload_jobs where requested_visibility='unlisted';
select throws_ok($$update videoalbum_private.upload_sessions set expires_at=now()+interval '8 days'$$,'23514',null,'session cannot outlive workflow');
update public.upload_jobs set state='uploaded' where requested_visibility='unlisted';
select is((select count(*)::int from videoalbum_private.upload_sessions),0,'terminal transfer clears session promptly');

-- Advance fixture clock by backdating ONLY as test superuser with the deadline trigger disabled.
alter table public.upload_workflows disable trigger workflow_deadline;
update public.upload_workflows set created_at=now()-interval '8 days',expires_at=now()-interval '1 day'
 where owner_id='00000000-0000-4000-8000-000000000021';
alter table public.upload_workflows enable trigger workflow_deadline;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000021';
select is((select count(*)::int from public.upload_workflows),0,'expired workflow invisible before sweep');
select is((select count(*)::int from public.upload_jobs),0,'expired jobs invisible before sweep');
select is((select count(*)::int from public.youtube_connections),0,'expired connection invisible before sweep');
select is((select count(*)::int from public.qr_ready_uploads),0,'expired workflow ineligible');
select throws_ok($$select public.request_upload('30000000-0000-4000-8000-000000000021','20000000-0000-4000-8000-000000000021',gen_random_uuid(),'Late')$$,'42501',null,'expired retry rejected');
reset role;
select throws_ok($$update public.upload_jobs set state='transferring' where owner_id='00000000-0000-4000-8000-000000000021'$$,'23514',null,'late worker write rejected');
select public.purge_expired_upload_data();
select is((select count(*)::int from public.upload_jobs),0,'sweep purges jobs');
select is((select count(*)::int from videoalbum_private.workflow_credentials),1,'sweep purges expired credentials, keeps B');
select is((select count(*)::int from public.videos),2,'provider cleanup preserves captions');
select is((select count(*)::int from videoalbum_private.upload_idempotency),3,'provider-free idempotency survives cleanup');
select throws_ok($$insert into public.upload_workflows(id,owner_id,album_id) values ('30000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000021','10000000-0000-4000-8000-000000000021')$$,'23514',null,'deleted workflow cannot resurrect');
insert into public.upload_workflows(id,owner_id,album_id) values
 ('30000000-0000-4000-8000-000000000023','00000000-0000-4000-8000-000000000021','10000000-0000-4000-8000-000000000021');
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000021';
select throws_ok($$select public.request_upload('30000000-0000-4000-8000-000000000023','20000000-0000-4000-8000-000000000021','40000000-0000-4000-8000-000000000021','Synthetic')$$,'23505',null,'purged request key cannot initiate again');
reset role;
select ok(not public.finish_upload_workflow('00000000-0000-4000-8000-000000000021','30000000-0000-4000-8000-000000000022'),'finish checks owner');
-- Populate every capability class before finish, including an expired OAuth state.
insert into public.upload_jobs(id,owner_id,workflow_id,album_id,video_id,idempotency_key,upload_title,state)
 values ('70000000-0000-4000-8000-000000000022','00000000-0000-4000-8000-000000000022',
 '30000000-0000-4000-8000-000000000022','10000000-0000-4000-8000-000000000022',
 '20000000-0000-4000-8000-000000000022',gen_random_uuid(),'Synthetic','transferring');
insert into videoalbum_private.upload_sessions(job_id,workflow_id,owner_id,session_cipher,key_id,expires_at)
 values ('70000000-0000-4000-8000-000000000022','30000000-0000-4000-8000-000000000022',
 '00000000-0000-4000-8000-000000000022','synthetic-envelope','test-v1',now()+interval '1 hour');
insert into videoalbum_private.oauth_states(state_hash,workflow_id,owner_id,verifier_cipher,key_id)
 values (repeat('b',64),'30000000-0000-4000-8000-000000000022',
 '00000000-0000-4000-8000-000000000022','synthetic-envelope','test-v1');
alter table videoalbum_private.oauth_states disable trigger live_oauth;
update videoalbum_private.oauth_states set expires_at=now()-interval '1 second';
alter table videoalbum_private.oauth_states enable trigger live_oauth;
select is((select count(*)::int from public.consume_upload_oauth('00000000-0000-4000-8000-000000000022',
 '30000000-0000-4000-8000-000000000022',repeat('b',64))),0,'expired OAuth unusable before physical sweep');
select ok(public.finish_upload_workflow('00000000-0000-4000-8000-000000000022','30000000-0000-4000-8000-000000000022'),'finish clears B');
select is((select count(*)::int from public.upload_jobs),0,'finish removes jobs');
select is((select count(*)::int from videoalbum_private.upload_sessions),0,'finish removes sessions');
select is((select count(*)::int from videoalbum_private.oauth_states),0,'finish removes OAuth state');
select is((select count(*)::int from videoalbum_private.workflow_credentials),0,'finish removes credentials');
select is((select count(*)::int from public.youtube_connections),0,'finish removes provider metadata');
select is((select count(*)::int from public.albums),2,'finish preserves albums');

update public.profiles set deletion_requested_at=now() where owner_id='00000000-0000-4000-8000-000000000021';
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000021';
select is((select count(*)::int from public.albums),0,'deletion request blocks app access immediately');
select is((select count(*)::int from public.videos),0,'deletion request blocks children');
reset role;
delete from auth.users where id='00000000-0000-4000-8000-000000000021';
select is((select count(*)::int from public.albums),1,'account cascade preserves B album');
select is((select count(*)::int from public.videos),1,'account cascade preserves B caption');
select is((select count(*)::int from videoalbum_private.upload_idempotency),0,'account cascade erases idempotency ledger');
select ok(exists(select 1 from videoalbum_private.deletion_ledger where resource_kind='account'
 and resource_id='00000000-0000-4000-8000-000000000021'),'account tombstone survives identity deletion');
select * from finish();
rollback;
