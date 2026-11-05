-- Include the verified destination title for the Account connection screen.
drop function public.channel_library_context(uuid,uuid);
create function public.channel_library_context(p_owner uuid, p_workflow uuid default null)
returns table(workflow_id uuid, expires_at timestamptz, channel_id text, channel_title text, refresh_cipher text, key_id text)
language sql stable security definer set search_path = '' as $$
  select w.id, w.expires_at, c.channel_id, c.channel_title, k.refresh_cipher, k.key_id
  from public.upload_workflows w
  join public.profiles p on p.owner_id = w.owner_id and p.deletion_requested_at is null
  join public.youtube_connections c on c.workflow_id = w.id and c.owner_id = w.owner_id
  join videoalbum_private.workflow_credentials k on k.workflow_id = w.id and k.owner_id = w.owner_id
  where w.owner_id = p_owner and w.expires_at > statement_timestamp()
    and k.revocation_requested_at is null and (p_workflow is null or w.id = p_workflow)
  order by w.created_at desc, w.id desc limit 1
$$;
revoke all on function public.channel_library_context(uuid,uuid) from public, anon, authenticated;
grant execute on function public.channel_library_context(uuid,uuid) to service_role;


-- Serialize connection writes with disconnect and account deletion on the owner row.
create function public.start_youtube_workflow(p_owner uuid, p_hash text, p_cipher text, p_key_id text, p_workflow uuid)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare a uuid; deadline timestamptz;
begin
  perform 1 from auth.users where id = p_owner for update;
  if not found or not exists (select 1 from public.profiles where owner_id=p_owner and deletion_requested_at is null) then
    raise exception 'Account unavailable' using errcode='42501';
  end if;
  if exists (select 1 from public.channel_library_context(p_owner)) or exists (
    select 1 from videoalbum_private.provider_revocations where owner_id=p_owner and expires_at>clock_timestamp()
  ) then
    raise exception 'Disconnect before reconnecting' using errcode='23514';
  end if;
  -- Only explicit initiation creates workflows; callbacks cannot recreate deleted work.
  delete from public.upload_workflows w where w.owner_id=p_owner
    and not exists (select 1 from public.youtube_connections c where c.workflow_id=w.id)
    and not exists (select 1 from public.upload_jobs j where j.workflow_id=w.id);
  select id into a from public.albums where owner_id=p_owner order by created_at, id limit 1;
  if a is null then
    insert into public.albums(owner_id,title) values(p_owner,'My videos') returning id into a;
  end if;
  insert into public.upload_workflows(id,owner_id,album_id) values(p_workflow,p_owner,a) returning expires_at into deadline;
  insert into videoalbum_private.oauth_states(state_hash,workflow_id,owner_id,verifier_cipher,key_id)
    values(p_hash,p_workflow,p_owner,p_cipher,p_key_id);
  return deadline;
end $$;
create function public.consume_youtube_workflow(p_owner uuid,p_hash text)
returns table(workflow_id uuid,verifier_cipher text,key_id text)
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from auth.users where id=p_owner for update;
  return query delete from videoalbum_private.oauth_states s using public.upload_workflows w, public.profiles p
    where s.workflow_id=w.id and s.owner_id=p_owner and w.owner_id=p_owner
      and p.owner_id=p_owner and p.deletion_requested_at is null
      and s.state_hash=p_hash and s.expires_at>clock_timestamp() and w.expires_at>clock_timestamp()
    returning s.workflow_id,s.verifier_cipher,s.key_id;
end $$;
create function public.save_youtube_workflow(p_owner uuid,p_workflow uuid,p_cipher text,p_key_id text,p_channel text,p_title text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from auth.users where id=p_owner for update;
  perform 1 from public.upload_workflows w join public.profiles p on p.owner_id=w.owner_id
    where w.id=p_workflow and w.owner_id=p_owner and w.expires_at>clock_timestamp()
      and p.deletion_requested_at is null for update of w;
  if not found then raise exception 'Workflow unavailable' using errcode='42501'; end if;
  if exists(select 1 from public.youtube_connections where owner_id=p_owner and channel_id<>p_channel) then
    raise exception 'Disconnect before changing channel' using errcode='23514';
  end if;
  insert into public.youtube_connections(workflow_id,owner_id,channel_id,channel_title,verified_at)
    values(p_workflow,p_owner,p_channel,p_title,clock_timestamp());
  insert into videoalbum_private.workflow_credentials(workflow_id,owner_id,refresh_cipher,key_id)
    values(p_workflow,p_owner,p_cipher,p_key_id);
end $$;
create function public.disconnect_youtube_workflows(p_owner uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from auth.users where id=p_owner for update;
  insert into videoalbum_private.provider_revocations(owner_id,credential_ref,refresh_cipher,key_id,workflow_id,expires_at)
    select p_owner,c.workflow_id::text,c.refresh_cipher,c.key_id,c.workflow_id,least(w.expires_at,clock_timestamp()+interval '1 day')
    from videoalbum_private.workflow_credentials c join public.upload_workflows w on w.id=c.workflow_id
    where c.owner_id=p_owner and w.expires_at>clock_timestamp() on conflict do nothing;
  delete from public.upload_workflows where owner_id=p_owner;
end $$;
revoke all on function public.start_youtube_workflow(uuid,text,text,text,uuid),
 public.consume_youtube_workflow(uuid,text), public.save_youtube_workflow(uuid,uuid,text,text,text,text),
 public.disconnect_youtube_workflows(uuid) from public,anon,authenticated;
grant execute on function public.start_youtube_workflow(uuid,text,text,text,uuid),
 public.consume_youtube_workflow(uuid,text), public.save_youtube_workflow(uuid,uuid,text,text,text,text),
 public.disconnect_youtube_workflows(uuid) to service_role;
-- Run without logins or Google availability. Sweep ahead to allow scheduling margin.
create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule('youtube-workflow-expiry','* * * * *',
 $$select public.purge_expired_upload_data(clock_timestamp()+interval '2 minutes');
 delete from videoalbum_private.provider_revocations where expires_at<=clock_timestamp()+interval '2 minutes';$$);
