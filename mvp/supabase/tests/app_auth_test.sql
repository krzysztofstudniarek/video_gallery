begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id) values
  ('00000000-0000-4000-8000-000000000041'), ('00000000-0000-4000-8000-000000000042');
insert into auth.sessions(id,user_id) values
  ('40000000-0000-4000-8000-000000000041','00000000-0000-4000-8000-000000000041');
insert into public.profiles(owner_id) values
  ('00000000-0000-4000-8000-000000000041'),('00000000-0000-4000-8000-000000000042');
insert into public.albums(owner_id,title) values
  ('00000000-0000-4000-8000-000000000041','A'),('00000000-0000-4000-8000-000000000042','B');
insert into public.upload_workflows(id, owner_id, album_id, created_at, expires_at)
  select '30000000-0000-4000-8000-000000000041', owner_id, id,
    now() - interval '6 days', now() + interval '1 day'
  from public.albums where owner_id='00000000-0000-4000-8000-000000000041';
-- Advance only the fixture's age as test superuser; production deadlines remain immutable.
alter table public.upload_workflows disable trigger workflow_deadline;
update public.upload_workflows set created_at=now()-interval '6 days', expires_at=now()+interval '1 day'
  where owner_id='00000000-0000-4000-8000-000000000041';
alter table public.upload_workflows enable trigger workflow_deadline;
insert into videoalbum_private.workflow_credentials(workflow_id,owner_id,refresh_cipher,key_id)
  values ('30000000-0000-4000-8000-000000000041','00000000-0000-4000-8000-000000000041','synthetic-workflow-envelope','test-v1');
select public.yt_probe_save('00000000-0000-4000-8000-000000000041','synthetic-cipher','synthetic','Synthetic');
select ok(not has_function_privilege('anon','public.current_app_session()','execute'),'anonymous cannot inspect sessions');
select ok(not has_function_privilege('authenticated',p.oid,'execute'),p.proname || ' is backend only')
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
  and p.proname in ('begin_account_deletion','pending_account_deletions','finish_account_deletion',
    'pending_provider_revocations','finish_provider_revocation',
    'note_account_deletion_attempt','note_provider_revocation_attempt');
select ok(not has_table_privilege('authenticated','videoalbum_private.' || t,'select,insert,update,delete'),t || ' private')
  from unnest(array['account_deletions','provider_revocations']) t;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000041","session_id":"40000000-0000-4000-8000-000000000041"}',true);
select ok((public.current_app_session()->>'active')::boolean,'live session accepted');
select lives_ok('select public.ensure_app_profile()','profile initialization is idempotent');
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000042","session_id":"40000000-0000-4000-8000-000000000041"}',true);
select ok(not (public.current_app_session()->>'active')::boolean,'cannot use another owner session');
reset role;
select public.begin_account_deletion('00000000-0000-4000-8000-000000000041');
select is((select count(*)::int from public.albums),1,'deletion cleans only owner albums');
select is((select count(*)::int from videoalbum_private.youtube_credentials),0,'probe credentials erased');
select is((select count(*)::int from videoalbum_private.provider_revocations),2,'revocation-only capabilities retained');
select is((select expires_at from videoalbum_private.provider_revocations where workflow_id is not null),
  now() + interval '1 day','workflow revocation retains its earlier original expiry');
select is((select expires_at from videoalbum_private.provider_revocations where workflow_id is null),
  now() + interval '7 days','probe revocation capped at original deletion deadline');
select is((select count(*)::int from videoalbum_private.workflow_credentials),0,'workflow source credential erased');
select throws_ok($$select public.yt_probe_save('00000000-0000-4000-8000-000000000041','late','synthetic','Synthetic')$$,'42501',null,'late probe writes rejected');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000041","session_id":"40000000-0000-4000-8000-000000000041"}',true);
select ok((public.current_app_session()->>'deletion_requested')::boolean,'deletion state visible only through caller session');
select is((select count(*)::int from public.profiles),0,'deleting profile hidden');
select throws_ok('select public.ensure_app_profile()','42501',null,'cannot recreate deleting profile');
reset role;
select public.begin_account_deletion('00000000-0000-4000-8000-000000000041');
select is((select count(*)::int from videoalbum_private.provider_revocations),2,'retry never duplicates revocation work');
select is((select expires_at from videoalbum_private.provider_revocations where workflow_id is not null),
  now() + interval '1 day','retry cannot extend workflow capability expiry');
delete from auth.users where id='00000000-0000-4000-8000-000000000041';
select public.finish_account_deletion('00000000-0000-4000-8000-000000000041');
select is((select count(*)::int from videoalbum_private.account_deletions),0,'finished identity removes retry work');
select is((select count(*)::int from videoalbum_private.provider_revocations),2,'Auth deletion does not lose revocation retry');
update videoalbum_private.provider_revocations set expires_at = now();
select is((select count(*)::int from public.pending_provider_revocations()),0,'expired revocation capability unavailable');
select is((select count(*)::int from videoalbum_private.provider_revocations),0,'expired ciphertext physically erased');
select * from finish();
rollback;
