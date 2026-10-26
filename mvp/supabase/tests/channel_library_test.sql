begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id) values
 ('00000000-0000-4000-8000-000000000061'), ('00000000-0000-4000-8000-000000000062');
insert into public.profiles(owner_id) select id from auth.users where id::text like '%00000000006_';
insert into public.albums(id,owner_id,title) values
 ('10000000-0000-4000-8000-000000000061','00000000-0000-4000-8000-000000000061','Synthetic A'),
 ('10000000-0000-4000-8000-000000000062','00000000-0000-4000-8000-000000000062','Synthetic B');
insert into public.upload_workflows(id,owner_id,album_id) values
 ('20000000-0000-4000-8000-000000000061','00000000-0000-4000-8000-000000000061','10000000-0000-4000-8000-000000000061'),
 ('20000000-0000-4000-8000-000000000062','00000000-0000-4000-8000-000000000062','10000000-0000-4000-8000-000000000062');
insert into public.youtube_connections(workflow_id,owner_id,channel_id,channel_title,verified_at)
 select id, owner_id, 'synthetic-channel', 'Synthetic', now() from public.upload_workflows
 where owner_id in ('00000000-0000-4000-8000-000000000061','00000000-0000-4000-8000-000000000062');
insert into videoalbum_private.workflow_credentials(workflow_id,owner_id,refresh_cipher,key_id)
 select id, owner_id, 'synthetic-cipher', 'test-v1' from public.upload_workflows
 where owner_id in ('00000000-0000-4000-8000-000000000061','00000000-0000-4000-8000-000000000062');

select ok(not has_function_privilege(r, p.oid, 'execute'), p.proname || ' denies ' || r)
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace,
 unnest(array['anon','authenticated']) r where n.nspname='public'
 and p.proname in ('channel_library_context','rotate_channel_library_credential');
select ok(p.proconfig @> array['search_path=""'], p.proname || ' pins search_path')
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
 and p.proname in ('channel_library_context','rotate_channel_library_credential');
set local role authenticated;
select throws_ok($$select * from public.channel_library_context('00000000-0000-4000-8000-000000000061')$$,
 '42501',null,'frontend cannot retrieve any credential context');
reset role;
set local role service_role;
select is((select count(*)::int from public.channel_library_context('00000000-0000-4000-8000-000000000061')),1,'backend selects owner A context');
select is((select count(*)::int from public.channel_library_context('00000000-0000-4000-8000-000000000062','20000000-0000-4000-8000-000000000061')),0,'foreign workflow cannot supply credentials');
select ok(public.rotate_channel_library_credential('00000000-0000-4000-8000-000000000061','20000000-0000-4000-8000-000000000061','synthetic-cipher','rotated-cipher','test-v1'),'backend can rotate the same live workflow');
select ok(not public.rotate_channel_library_credential('00000000-0000-4000-8000-000000000061','20000000-0000-4000-8000-000000000061','synthetic-cipher','late-cipher','test-v1'),'stale refresh cannot overwrite rotated credential');
select ok(not public.rotate_channel_library_credential('00000000-0000-4000-8000-000000000062','20000000-0000-4000-8000-000000000061','rotated-cipher','forged-cipher','test-v1'),'rotation checks parent ownership');
select is((select refresh_cipher from public.channel_library_context('00000000-0000-4000-8000-000000000061')),'rotated-cipher','rotation has expected result');
reset role;
update videoalbum_private.workflow_credentials set revocation_requested_at=now()
 where owner_id='00000000-0000-4000-8000-000000000061';
select is((select count(*)::int from public.channel_library_context('00000000-0000-4000-8000-000000000061')),0,'revocation intent immediately blocks reads');
select ok(not public.rotate_channel_library_credential('00000000-0000-4000-8000-000000000061','20000000-0000-4000-8000-000000000061','rotated-cipher','late-cipher','test-v1'),'revocation blocks rotation');
update videoalbum_private.workflow_credentials set revocation_requested_at=null
 where owner_id='00000000-0000-4000-8000-000000000061';
update public.profiles set deletion_requested_at=now() where owner_id='00000000-0000-4000-8000-000000000061';
select is((select count(*)::int from public.channel_library_context('00000000-0000-4000-8000-000000000061')),0,'deleting account cannot browse');
update public.profiles set deletion_requested_at=null where owner_id='00000000-0000-4000-8000-000000000061';
-- Test-only clock fixture: production cannot mutate the deadline.
set local session_replication_role=replica;
update public.upload_workflows set created_at=now()-interval '8 days', expires_at=now()-interval '1 day'
 where owner_id='00000000-0000-4000-8000-000000000061';
set local session_replication_role=origin;
select is((select count(*)::int from public.channel_library_context('00000000-0000-4000-8000-000000000061')),0,'expiry blocks credentials even before cleanup');
select ok(not public.rotate_channel_library_credential('00000000-0000-4000-8000-000000000061','20000000-0000-4000-8000-000000000061','rotated-cipher','late-cipher','test-v1'),'expired credential cannot rotate');
delete from public.albums where owner_id='00000000-0000-4000-8000-000000000062';
select is((select count(*)::int from public.channel_library_context('00000000-0000-4000-8000-000000000062')),0,'album deletion removes library access and credentials');
select * from finish();
rollback;
