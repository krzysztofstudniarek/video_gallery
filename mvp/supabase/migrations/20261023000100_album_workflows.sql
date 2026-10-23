-- Production metadata model. Historical spike tables/RPCs are separate and unchanged.
-- Auth owns identities and sessions; no provider destinations belong in durable entries.
create table public.profiles (
  owner_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  display_name text not null default '' check (length(display_name) <= 100),
  created_at timestamptz not null default now(),
  deletion_requested_at timestamptz
);
create table public.albums (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 200),
  qr_preset_id smallint not null default 1 check (qr_preset_id between 1 and 4),
  sort_order bigint not null default 0,
  created_at timestamptz not null default now(),
  unique (id, owner_id)
);
create index albums_owner_order on public.albums(owner_id, sort_order, id);
create table public.videos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  album_id uuid not null,
  caption text not null default '' check (length(caption) <= 2000),
  sort_order bigint not null default 0,
  created_at timestamptz not null default now(),
  foreign key (album_id, owner_id) references public.albums(id, owner_id) on delete cascade,
  unique (id, album_id, owner_id)
);
create index videos_album_order on public.videos(album_id, sort_order, id);
create index videos_owner on public.videos(owner_id);
create table public.upload_workflows (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  album_id uuid not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  foreign key (album_id, owner_id) references public.albums(id, owner_id) on delete cascade,
  unique (id, owner_id),
  unique (id, album_id, owner_id),
  check (expires_at = created_at + interval '7 days')
);
create index workflows_owner on public.upload_workflows(owner_id, album_id);
create index workflows_cleanup on public.upload_workflows(expires_at);
create table public.youtube_connections (
  workflow_id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  channel_id text not null check (length(channel_id) between 1 and 128),
  channel_title text not null check (length(channel_title) <= 200),
  verified_at timestamptz not null,
  foreign key (workflow_id, owner_id) references public.upload_workflows(id, owner_id) on delete cascade
);
create index connections_owner on public.youtube_connections(owner_id);
create table public.upload_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  workflow_id uuid not null,
  album_id uuid not null,
  video_id uuid not null,
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  requested_visibility text not null default 'unlisted'
    check (requested_visibility in ('private', 'unlisted', 'public')),
  public_confirmed_at timestamptz,
  upload_title text not null check (length(btrim(upload_title)) between 1 and 100),
  upload_description text not null default '' check (length(upload_description) <= 5000),
  state text not null default 'queued'
    check (state in ('queued', 'initiating', 'transferring', 'uploaded', 'failed', 'cancelled')),
  provider_video_id text check (provider_video_id ~ '^[A-Za-z0-9_-]{11}$'),
  effective_visibility text check (effective_visibility in ('private', 'unlisted', 'public')),
  processing_status text not null default 'pending'
    check (processing_status in ('pending', 'processing', 'succeeded', 'failed')),
  verified_at timestamptz,
  channel_verified boolean not null default false,
  anonymous_playback_verified_at timestamptz,
  verified_size_bytes bigint check (verified_size_bytes > 0),
  verified_duration_seconds numeric check (verified_duration_seconds > 0),
  foreign key (workflow_id, album_id, owner_id)
    references public.upload_workflows(id, album_id, owner_id) on delete cascade,
  foreign key (video_id, album_id, owner_id)
    references public.videos(id, album_id, owner_id) on delete cascade,
  unique (owner_id, idempotency_key),
  unique (id, workflow_id, owner_id),
  check ((requested_visibility = 'public') = (public_confirmed_at is not null)),
  check (verified_at is null or
    (provider_video_id is not null and effective_visibility is not null)),
  check (anonymous_playback_verified_at is null or verified_at is not null)
);
create index jobs_workflow on public.upload_jobs(workflow_id, owner_id);
create index jobs_video on public.upload_jobs(video_id, album_id, owner_id);

-- Explicit envelope key IDs; encryption/decryption is performed only by trusted workers.
-- Never add this schema to api.schemas/extra_search_path or generated frontend types.
create table videoalbum_private.workflow_credentials (
  workflow_id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  refresh_cipher text not null check (length(refresh_cipher) > 0),
  key_id text not null check (length(key_id) between 1 and 100),
  revocation_requested_at timestamptz,
  foreign key (workflow_id, owner_id) references public.upload_workflows(id, owner_id) on delete cascade
);
create table videoalbum_private.upload_sessions (
  job_id uuid primary key,
  workflow_id uuid not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  session_cipher text not null check (length(session_cipher) > 0),
  key_id text not null check (length(key_id) between 1 and 100),
  expires_at timestamptz not null,
  foreign key (job_id, workflow_id, owner_id)
    references public.upload_jobs(id, workflow_id, owner_id) on delete cascade
);
create table videoalbum_private.oauth_states (
  state_hash text primary key check (state_hash ~ '^[0-9a-f]{64}$'),
  workflow_id uuid not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  verifier_cipher text not null check (length(verifier_cipher) > 0),
  key_id text not null check (length(key_id) between 1 and 100),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '10 minutes',
  foreign key (workflow_id, owner_id) references public.upload_workflows(id, owner_id) on delete cascade
);
create index oauth_cleanup on videoalbum_private.oauth_states(expires_at);
-- Only app-generated IDs and timestamps survive provider cleanup. No file/provider metadata.
create table videoalbum_private.upload_idempotency (
  owner_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key uuid not null,
  workflow_id uuid not null,
  job_id uuid not null unique,
  created_at timestamptz not null default now(),
  initiation_claimed_at timestamptz,
  primary key (owner_id, idempotency_key)
);
-- No auth FK: restoration tombstones must survive deleting the identity itself.
create table videoalbum_private.deletion_ledger (
  resource_kind text not null check (resource_kind in ('account', 'album', 'video', 'workflow')),
  resource_id uuid not null,
  deleted_at timestamptz not null default now(),
  primary key (resource_kind, resource_id)
);

-- Functions called by triggers have no direct API execution grants.
create function videoalbum_private.guard_workflow()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := clock_timestamp();
    new.expires_at := new.created_at + interval '7 days';
  elsif (new.id, new.owner_id, new.album_id, new.created_at, new.expires_at)
    is distinct from (old.id, old.owner_id, old.album_id, old.created_at, old.expires_at) then
    raise exception 'Workflow identity and deadline are immutable' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger workflow_deadline before insert or update on public.upload_workflows
for each row execute function videoalbum_private.guard_workflow();

create function videoalbum_private.guard_live_child()
returns trigger language plpgsql security definer set search_path = '' as $$
declare deadline timestamptz;
begin
  if tg_op = 'UPDATE' and (new.workflow_id, new.owner_id) is distinct from (old.workflow_id, old.owner_id) then
    raise exception 'Workflow attachment is immutable' using errcode = '23514';
  end if;
  -- Serialize writes with finish/cancel/delete, and reject expired or deleted parents.
  select w.expires_at into deadline from public.upload_workflows w
    join public.profiles p on p.owner_id = w.owner_id and p.deletion_requested_at is null
    where w.id = new.workflow_id and w.owner_id = new.owner_id for update of w;
  if deadline is null or deadline <= clock_timestamp() then
    raise exception 'Workflow unavailable' using errcode = '23514';
  end if;
  if tg_table_name = 'oauth_states' then
    if tg_op = 'INSERT' then
      new.created_at := clock_timestamp();
      new.expires_at := least(deadline, new.created_at + interval '10 minutes');
    elsif (new.created_at, new.expires_at) is distinct from (old.created_at, old.expires_at) then
      raise exception 'OAuth deadline is immutable' using errcode = '23514';
    end if;
  elsif tg_table_name = 'upload_sessions' then
    if new.expires_at > deadline or new.expires_at <= clock_timestamp() or not exists (
      select 1 from public.upload_jobs j where j.id = new.job_id
        and j.state in ('initiating', 'transferring')
    ) then
      raise exception 'Upload session unavailable' using errcode = '23514';
    end if;
    if tg_op = 'UPDATE' and new.expires_at > old.expires_at then
      raise exception 'Session deadline cannot extend' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
create trigger live_job before insert or update on public.upload_jobs
for each row execute function videoalbum_private.guard_live_child();
create trigger live_connection before insert or update on public.youtube_connections
for each row execute function videoalbum_private.guard_live_child();
create trigger live_credential before insert or update on videoalbum_private.workflow_credentials
for each row execute function videoalbum_private.guard_live_child();
create trigger live_session before insert or update on videoalbum_private.upload_sessions
for each row execute function videoalbum_private.guard_live_child();
create trigger live_oauth before insert or update on videoalbum_private.oauth_states
for each row execute function videoalbum_private.guard_live_child();

-- Request/consent evidence cannot be repurposed for another upload, even by a worker.
create function videoalbum_private.guard_job_request()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (new.id, new.owner_id, new.workflow_id, new.album_id, new.video_id, new.idempotency_key,
      new.created_at, new.requested_visibility, new.public_confirmed_at, new.upload_title, new.upload_description)
    is distinct from (old.id, old.owner_id, old.workflow_id, old.album_id, old.video_id, old.idempotency_key,
      old.created_at, old.requested_visibility, old.public_confirmed_at, old.upload_title, old.upload_description) then
    raise exception 'Upload request and confirmation are immutable' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger immutable_job_request before update on public.upload_jobs
for each row execute function videoalbum_private.guard_job_request();

-- Deleting an entry ends workflows whose only jobs belong to that entry. Shared
-- workflow credentials remain only when another entry still needs that workflow.
create function videoalbum_private.end_entry_workflows()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from public.upload_workflows w where w.owner_id = old.owner_id
    and exists (select 1 from public.upload_jobs j where j.workflow_id = w.id and j.video_id = old.id)
    and not exists (select 1 from public.upload_jobs j where j.workflow_id = w.id and j.video_id <> old.id);
  return old;
end $$;
create trigger end_deleted_entry before delete on public.videos
for each row execute function videoalbum_private.end_entry_workflows();

create function videoalbum_private.clear_terminal_session()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.state in ('uploaded', 'failed', 'cancelled') then
    delete from videoalbum_private.upload_sessions where job_id = new.id;
  end if;
  return new;
end $$;
create trigger terminal_session after update of state on public.upload_jobs
for each row execute function videoalbum_private.clear_terminal_session();

create function videoalbum_private.record_deletion()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into videoalbum_private.deletion_ledger(resource_kind, resource_id)
    values (tg_argv[0], old.id)
    on conflict do nothing;
  return old;
end $$;
create trigger deleted_account after delete on auth.users
for each row execute function videoalbum_private.record_deletion('account');
create trigger deleted_album after delete on public.albums
for each row execute function videoalbum_private.record_deletion('album');
create trigger deleted_video after delete on public.videos
for each row execute function videoalbum_private.record_deletion('video');
create trigger deleted_workflow after delete on public.upload_workflows
for each row execute function videoalbum_private.record_deletion('workflow');

create function videoalbum_private.reject_resurrection()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from videoalbum_private.deletion_ledger
    where (resource_kind = tg_argv[0] and resource_id = new.id)
      or (resource_kind = 'account' and resource_id = new.owner_id)) then
    raise exception 'Deleted resource cannot be recreated' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger no_deleted_album before insert on public.albums
for each row execute function videoalbum_private.reject_resurrection('album');
create trigger no_deleted_video before insert on public.videos
for each row execute function videoalbum_private.reject_resurrection('video');
create trigger no_deleted_workflow before insert on public.upload_workflows
for each row execute function videoalbum_private.reject_resurrection('workflow');

-- Clients may edit only app-authored fields. In particular table-level UPDATE/INSERT
-- would override column restrictions, so explicitly remove Supabase default grants.
do $$
declare t text;
begin
  foreach t in array array['profiles', 'albums', 'videos', 'upload_workflows',
    'upload_jobs', 'youtube_connections'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
  foreach t in array array['workflow_credentials', 'upload_sessions', 'oauth_states',
    'upload_idempotency', 'deletion_ledger'] loop
    execute format('alter table videoalbum_private.%I enable row level security', t);
    execute format('revoke all on videoalbum_private.%I from public, anon, authenticated', t);
    execute format('grant all on videoalbum_private.%I to service_role', t);
  end loop;
end $$;
revoke all on schema videoalbum_private from public, anon, authenticated;
grant usage on schema videoalbum_private to service_role;
grant insert (owner_id, display_name), update (display_name) on public.profiles to authenticated;
grant insert (id, owner_id, title, qr_preset_id, sort_order), update (title, qr_preset_id, sort_order)
  on public.albums to authenticated;
grant insert (id, owner_id, album_id, caption, sort_order), update (caption, sort_order)
  on public.videos to authenticated;
grant insert (id, owner_id, album_id) on public.upload_workflows to authenticated;
grant delete on public.albums, public.videos to authenticated;

create policy profile_owner on public.profiles to authenticated
  using (owner_id = (select auth.uid()) and deletion_requested_at is null)
  with check (owner_id = (select auth.uid()) and deletion_requested_at is null);
create policy album_owner on public.albums to authenticated
  using (owner_id = (select auth.uid()) and exists (select 1 from public.profiles p where p.owner_id = albums.owner_id))
  with check (owner_id = (select auth.uid()) and exists (select 1 from public.profiles p where p.owner_id = albums.owner_id));
create policy video_owner on public.videos to authenticated
  using (owner_id = (select auth.uid()) and exists (select 1 from public.albums a where a.id = videos.album_id and a.owner_id = videos.owner_id))
  with check (owner_id = (select auth.uid()) and exists (select 1 from public.albums a where a.id = videos.album_id and a.owner_id = videos.owner_id));
create policy workflow_owner on public.upload_workflows to authenticated
  using (owner_id = (select auth.uid()) and expires_at > statement_timestamp()
    and exists (select 1 from public.albums a where a.id = upload_workflows.album_id and a.owner_id = upload_workflows.owner_id))
  with check (owner_id = (select auth.uid()) and expires_at > statement_timestamp()
    and exists (select 1 from public.albums a where a.id = upload_workflows.album_id and a.owner_id = upload_workflows.owner_id));
create policy job_owner on public.upload_jobs for select to authenticated
  using (owner_id = (select auth.uid())
    and exists (select 1 from public.upload_workflows w where w.id = upload_jobs.workflow_id and w.owner_id = upload_jobs.owner_id)
    and exists (select 1 from public.videos v where v.id = upload_jobs.video_id and v.owner_id = upload_jobs.owner_id));
create policy connection_owner on public.youtube_connections for select to authenticated
  using (owner_id = (select auth.uid()) and exists (select 1 from public.upload_workflows w where w.id = youtube_connections.workflow_id and w.owner_id = youtube_connections.owner_id));

-- This view carries no archived URLs. RLS is evaluated as the caller (PG 17).
create view public.qr_ready_uploads with (security_invoker = true) as
select j.id, j.owner_id, j.workflow_id, j.video_id, j.provider_video_id,
  j.effective_visibility, j.verified_at
from public.upload_jobs j join public.upload_workflows w on w.id = j.workflow_id and w.owner_id = j.owner_id
where w.expires_at > statement_timestamp() and j.state = 'uploaded'
  and j.processing_status = 'succeeded' and j.channel_verified and j.verified_at is not null
  and j.anonymous_playback_verified_at >= j.verified_at
  and j.provider_video_id is not null and j.effective_visibility = j.requested_visibility
  and j.effective_visibility in ('public', 'unlisted')
  and (j.effective_visibility <> 'public' or j.public_confirmed_at is not null)
  and j.verified_size_bytes <= 1073741824 and j.verified_duration_seconds <= 600;
revoke all on public.qr_ready_uploads from public, anon, authenticated;
grant select on public.qr_ready_uploads to authenticated, service_role;

-- The only user-callable privileged mutation: verified auth.uid(), locked parent,
-- explicit per-job confirmation, no parameters for state/verification/capabilities.
create function public.request_upload(
  p_workflow_id uuid, p_video_id uuid, p_idempotency_key uuid, p_upload_title text,
  p_requested_visibility text default 'unlisted', p_confirm_public boolean default false,
  p_upload_description text default ''
) returns uuid language plpgsql security definer set search_path = '' as $$
declare w public.upload_workflows; j public.upload_jobs; reserved uuid;
begin
  select * into w from public.upload_workflows where id = p_workflow_id and owner_id = auth.uid() for update;
  if not found or w.expires_at <= clock_timestamp() or not exists (
    select 1 from public.profiles where owner_id = auth.uid() and deletion_requested_at is null
  ) or not exists (
    select 1 from public.videos where id = p_video_id and owner_id = auth.uid() and album_id = w.album_id
  ) then
    raise exception 'Workflow unavailable' using errcode = '42501';
  end if;
  if p_requested_visibility not in ('private', 'unlisted', 'public') or p_requested_visibility is null
    or p_confirm_public is null or (p_requested_visibility = 'public' and not p_confirm_public) then
    raise exception 'Public visibility requires per-upload confirmation' using errcode = '23514';
  end if;
  reserved := gen_random_uuid();
  insert into videoalbum_private.upload_idempotency(owner_id, idempotency_key, workflow_id, job_id)
    values (auth.uid(), p_idempotency_key, w.id, reserved) on conflict do nothing;
  if not found then
    select u.* into j from public.upload_jobs u where owner_id = auth.uid() and idempotency_key = p_idempotency_key;
    if not found or (j.workflow_id, j.video_id, j.upload_title, j.upload_description, j.requested_visibility)
      is distinct from (w.id, p_video_id, p_upload_title, p_upload_description, p_requested_visibility) then
      raise exception 'Idempotency key already used' using errcode = '23505';
    end if;
    return j.id;
  end if;
  insert into public.upload_jobs(id, owner_id, workflow_id, album_id, video_id, idempotency_key,
    upload_title, upload_description, requested_visibility, public_confirmed_at)
    values (reserved, auth.uid(), w.id, w.album_id, p_video_id, p_idempotency_key,
      p_upload_title, p_upload_description, p_requested_visibility,
      case when p_requested_visibility = 'public' then clock_timestamp() else null end);
  return reserved;
end $$;

-- Backend entry points recheck owner/workflow/deadline before returning capabilities.
create function public.consume_upload_oauth(p_owner uuid, p_workflow uuid, p_hash text)
returns table(verifier_cipher text, key_id text)
language sql security definer set search_path = '' as $$
  delete from videoalbum_private.oauth_states s using public.upload_workflows w, public.profiles p
  where s.workflow_id = w.id and s.owner_id = w.owner_id and p.owner_id = w.owner_id
    and p.deletion_requested_at is null and w.owner_id = p_owner and w.id = p_workflow
    and w.expires_at > clock_timestamp() and s.expires_at > clock_timestamp() and s.state_hash = p_hash
  returning s.verifier_cipher, s.key_id
$$;
create function public.finish_upload_workflow(p_owner uuid, p_workflow uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  -- Caller delivers owner downloads before invoking this for completion; also used for cancellation.
  delete from public.upload_workflows where id = p_workflow and owner_id = p_owner;
  return found;
end $$;
create function public.purge_expired_upload_data(p_before timestamptz default clock_timestamp())
returns void language plpgsql security definer set search_path = '' as $$
begin
  -- Workers may sweep ahead of hard expiry, never use login as the cleanup scheduler.
  delete from public.upload_workflows where expires_at <= p_before;
  delete from videoalbum_private.oauth_states where expires_at <= p_before;
  delete from videoalbum_private.upload_sessions where expires_at <= p_before;
end $$;
revoke all on all functions in schema videoalbum_private from public, anon, authenticated;
revoke all on function public.request_upload(uuid,uuid,uuid,text,text,boolean,text),
  public.consume_upload_oauth(uuid,uuid,text), public.finish_upload_workflow(uuid,uuid),
  public.purge_expired_upload_data(timestamptz) from public, anon, authenticated;
grant execute on function public.request_upload(uuid,uuid,uuid,text,text,boolean,text) to authenticated;
grant execute on function public.consume_upload_oauth(uuid,uuid,text),
  public.finish_upload_workflow(uuid,uuid), public.purge_expired_upload_data(timestamptz) to service_role;
