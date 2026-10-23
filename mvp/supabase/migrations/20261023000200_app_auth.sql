-- Supabase remains the only session store. These queues contain deletion work,
-- never replacement identities/sessions or reusable provider authorization.
create table videoalbum_private.account_deletions (
  owner_id uuid primary key,
  requested_at timestamptz not null default now(),
  last_attempt_at timestamptz
);
create table videoalbum_private.provider_revocations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  credential_ref text not null,
  refresh_cipher text not null,
  key_id text not null,
  workflow_id uuid,
  expires_at timestamptz not null,
  last_attempt_at timestamptz,
  unique (owner_id, credential_ref)
);
create index revocations_expiry on videoalbum_private.provider_revocations(expires_at);
alter table videoalbum_private.account_deletions enable row level security;
alter table videoalbum_private.provider_revocations enable row level security;
revoke all on videoalbum_private.account_deletions, videoalbum_private.provider_revocations
  from public, anon, authenticated;

-- Only the caller's verified JWT can select a session; no supplied owner/session ID.
create function public.current_app_session()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'active', exists (select 1 from auth.sessions s
      where s.user_id = auth.uid() and s.id::text = auth.jwt()->>'session_id'
      and (s.not_after is null or s.not_after > statement_timestamp())),
    'deletion_requested', exists (select 1 from public.profiles p
      where p.owner_id = auth.uid() and p.deletion_requested_at is not null)
      or exists (select 1 from videoalbum_private.account_deletions d where d.owner_id = auth.uid())
      or exists (select 1 from videoalbum_private.deletion_ledger d
        where d.resource_kind = 'account' and d.resource_id = auth.uid())
  )
$$;
revoke all on function public.current_app_session() from public, anon;
grant execute on function public.current_app_session() to authenticated;

create function public.ensure_app_profile()
returns void language plpgsql security invoker set search_path = '' as $$
declare s jsonb := public.current_app_session();
begin
  if not (s->>'active')::boolean or (s->>'deletion_requested')::boolean then
    raise exception 'Account unavailable' using errcode = '42501';
  end if;
  insert into public.profiles(owner_id) values (auth.uid()) on conflict (owner_id) do nothing;
end $$;
revoke all on function public.ensure_app_profile() from public, anon;
grant execute on function public.ensure_app_profile() to authenticated;

-- Deletion marker remains authoritative even if an Auth admin request must retry.
create policy profile_not_deleting on public.profiles as restrictive to authenticated
  using (not (public.current_app_session()->>'deletion_requested')::boolean)
  with check (not (public.current_app_session()->>'deletion_requested')::boolean);
create policy spike_not_deleting on public.spike_items as restrictive to authenticated
  using (not (public.current_app_session()->>'deletion_requested')::boolean)
  with check (not (public.current_app_session()->>'deletion_requested')::boolean);

create function public.begin_account_deletion(p_owner uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  -- Serialize duplicate requests, and retain the original request/deadline.
  perform 1 from auth.users where id = p_owner for update;
  if not found then return; end if;
  insert into videoalbum_private.account_deletions(owner_id) values (p_owner)
    on conflict do nothing;
  insert into public.profiles(owner_id, deletion_requested_at) values (p_owner, now())
    on conflict (owner_id) do update
    set deletion_requested_at = coalesce(profiles.deletion_requested_at, excluded.deletion_requested_at);

  insert into videoalbum_private.provider_revocations
    (owner_id, credential_ref, refresh_cipher, key_id, expires_at)
    select p_owner, 'probe', c.refresh_cipher, 'probe-v1', d.requested_at + interval '7 days'
    from videoalbum_private.youtube_credentials c
    join videoalbum_private.account_deletions d on d.owner_id = c.owner_id
    where c.owner_id = p_owner on conflict do nothing;
  insert into videoalbum_private.provider_revocations
    (owner_id, credential_ref, refresh_cipher, key_id, workflow_id, expires_at)
    select p_owner, c.workflow_id::text, c.refresh_cipher, c.key_id, c.workflow_id,
      least(w.expires_at, d.requested_at + interval '7 days')
    from videoalbum_private.workflow_credentials c
    join public.upload_workflows w on w.id = c.workflow_id
    join videoalbum_private.account_deletions d on d.owner_id = c.owner_id
    where c.owner_id = p_owner and w.expires_at > now() on conflict do nothing;

  -- No provider call is needed to deny access or erase local application data.
  delete from public.albums where owner_id = p_owner;
  delete from public.spike_items where owner_id = p_owner;
  delete from videoalbum_private.upload_idempotency where owner_id = p_owner;
  perform public.yt_probe_forget(p_owner);
end $$;

create function public.pending_account_deletions()
returns setof videoalbum_private.account_deletions
language sql stable security definer set search_path = '' as $$
  select * from videoalbum_private.account_deletions
    order by last_attempt_at nulls first, requested_at limit 10
$$;
create function public.finish_account_deletion(p_owner uuid)
returns void language sql security definer set search_path = '' as $$
  delete from videoalbum_private.account_deletions
    where owner_id = p_owner and not exists (select 1 from auth.users where id = p_owner)
$$;
create function public.pending_provider_revocations(p_owner uuid default null)
returns setof videoalbum_private.provider_revocations
language plpgsql security definer set search_path = '' as $$
begin
  delete from videoalbum_private.provider_revocations where expires_at <= now();
  return query select r.* from videoalbum_private.provider_revocations r
    where (p_owner is null or r.owner_id = p_owner)
    order by r.last_attempt_at nulls first, r.expires_at limit 5;
end $$;
create function public.note_account_deletion_attempt(p_owner uuid)
returns void language sql security definer set search_path = '' as $$
  update videoalbum_private.account_deletions set last_attempt_at = now() where owner_id = p_owner
$$;
create function public.note_provider_revocation_attempt(p_id uuid)
returns void language sql security definer set search_path = '' as $$
  update videoalbum_private.provider_revocations set last_attempt_at = now() where id = p_id
$$;
create function public.finish_provider_revocation(p_id uuid)
returns void language sql security definer set search_path = '' as $$
  delete from videoalbum_private.provider_revocations where id = p_id
$$;

revoke all on function public.begin_account_deletion(uuid), public.pending_account_deletions(),
  public.finish_account_deletion(uuid), public.pending_provider_revocations(uuid),
  public.finish_provider_revocation(uuid), public.note_account_deletion_attempt(uuid),
  public.note_provider_revocation_attempt(uuid) from public, anon, authenticated;
grant execute on function public.begin_account_deletion(uuid), public.pending_account_deletions(),
  public.finish_account_deletion(uuid), public.pending_provider_revocations(uuid),
  public.finish_provider_revocation(uuid), public.note_account_deletion_attempt(uuid),
  public.note_provider_revocation_attempt(uuid) to service_role;

-- An already-running historical probe must not repopulate data after deletion.
create function videoalbum_private.reject_deleting_probe()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from auth.users where id = new.owner_id for key share;
  if not found or exists (select 1 from videoalbum_private.account_deletions where owner_id = new.owner_id)
    or exists (select 1 from public.profiles where owner_id = new.owner_id and deletion_requested_at is not null) then
    raise exception 'Account unavailable' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function videoalbum_private.reject_deleting_probe() from public, anon, authenticated;
create trigger live_probe_consent before insert or update on videoalbum_private.youtube_consent
  for each row execute function videoalbum_private.reject_deleting_probe();
create trigger live_probe_credentials before insert or update on videoalbum_private.youtube_credentials
  for each row execute function videoalbum_private.reject_deleting_probe();
create trigger live_probe_upload before insert or update on videoalbum_private.youtube_upload_probe
  for each row execute function videoalbum_private.reject_deleting_probe();
