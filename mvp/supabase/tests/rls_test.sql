begin;
create extension if not exists pgtap with schema extensions;
select plan(9);
insert into auth.users(id) values
 ('00000000-0000-4000-8000-000000000001'),
 ('00000000-0000-4000-8000-000000000002');
insert into public.spike_items(owner_id,caption,video_id,share_token,sharing_enabled) values
 ('00000000-0000-4000-8000-000000000001','A','synthetic01','10000000-0000-4000-8000-000000000001',true),
 ('00000000-0000-4000-8000-000000000002','B','synthetic02','10000000-0000-4000-8000-000000000002',false);
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
select is((select count(*)::int from public.spike_items),1,'A sees only own row');
select is((select caption from public.spike_items),'A','A cannot read B');
select throws_ok($$insert into public.spike_items(owner_id,caption,video_id) values ('00000000-0000-4000-8000-000000000002','forged','synthetic03')$$,'42501',null,'A cannot insert as B');
with changed as (update public.spike_items set caption='forged' where caption='B' returning id)
select is((select count(*)::int from changed),0,'A cannot update B');
with removed as (delete from public.spike_items where caption='B' returning id)
select is((select count(*)::int from removed),0,'A cannot delete B');
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000002';
select is((select caption from public.spike_items),'B','B sees only own row');
reset role;
select ok(not has_table_privilege('anon','public.spike_items','select'),'anon cannot read table');
select ok(not has_function_privilege('anon','public.resolve_spike_share(uuid)','execute'),'anon cannot execute resolver RPC');
set local role service_role;
select is((select count(*)::int from public.resolve_spike_share('10000000-0000-4000-8000-000000000002')),0,'disabled sharing cannot resolve');
select * from finish();
rollback;
