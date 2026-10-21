begin;
create extension if not exists pgtap with schema extensions;
select plan(12);
insert into auth.users(id) values ('00000000-0000-4000-8000-000000000011'),('00000000-0000-4000-8000-000000000012');
select ok(not has_schema_privilege('anon','videoalbum_private','usage'),'anon cannot access private schema');
select ok(not has_schema_privilege('authenticated','videoalbum_private','usage'),'users cannot access private schema');
select ok(not has_function_privilege('authenticated','public.yt_probe_credentials(uuid)','execute'),'user cannot read credentials RPC');
select ok(not has_function_privilege('anon','public.yt_probe_consume(uuid,text)','execute'),'anon cannot consume consent');
select is((select count(*)::int from pg_proc p join pg_namespace n on p.pronamespace=n.oid
  where n.nspname='public' and p.proname like 'yt_probe_%' and has_function_privilege('authenticated',p.oid,'execute')),0,'no YouTube privileged RPC exposed to users');
set local role service_role;
select public.yt_probe_start('00000000-0000-4000-8000-000000000011','hash','verifier');
select is((select count(*)::int from public.yt_probe_consume('00000000-0000-4000-8000-000000000012','hash')),0,'different owner cannot consume state');
select is((select verifier from public.yt_probe_consume('00000000-0000-4000-8000-000000000011','hash')),'verifier','owner consumes state');
select is((select count(*)::int from public.yt_probe_consume('00000000-0000-4000-8000-000000000011','hash')),0,'state cannot replay');
reset role;
insert into videoalbum_private.youtube_consent(owner_id,state_hash,verifier,expires_at)
  values('00000000-0000-4000-8000-000000000011','expired','verifier',now()-interval '1 second');
set local role service_role;
select is((select count(*)::int from public.yt_probe_consume('00000000-0000-4000-8000-000000000011','expired')),0,'expired state rejected');
select public.yt_probe_save('00000000-0000-4000-8000-000000000011','synthetic-encrypted-envelope','synthetic-channel','Synthetic');
select is((select count(*)::int from public.yt_probe_credentials('00000000-0000-4000-8000-000000000012')),0,'no other-owner credential result');
select public.yt_probe_reserve('00000000-0000-4000-8000-000000000011','10000000-0000-4000-8000-000000000011',1,repeat('a',64));
select throws_ok($$select public.yt_probe_reserve('00000000-0000-4000-8000-000000000011','10000000-0000-4000-8000-000000000012',1,repeat('a',64))$$,'23505',null,'duplicate initiation blocked');
select public.yt_probe_forget('00000000-0000-4000-8000-000000000011');
select is((select count(*)::int from public.yt_probe_credentials('00000000-0000-4000-8000-000000000011')),0,'forget removes credentials');
select * from finish();
rollback;
