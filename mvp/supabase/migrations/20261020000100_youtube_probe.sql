-- Compatibility spike only. Private tables are not in the Data API schema list.
create schema if not exists videoalbum_private;
revoke all on schema videoalbum_private from public, anon, authenticated;

create table videoalbum_private.youtube_consent (
  owner_id uuid primary key references auth.users on delete cascade,
  state_hash text not null unique,
  verifier text not null,
  expires_at timestamptz not null default now() + interval '10 minutes'
);
create table videoalbum_private.youtube_credentials (
  owner_id uuid primary key references auth.users on delete cascade,
  refresh_cipher text not null,
  channel_id text not null,
  channel_title text not null
);
create table videoalbum_private.youtube_upload_probe (
  owner_id uuid primary key references auth.users on delete cascade,
  job_id uuid not null unique,
  session_cipher text,
  file_sha256 text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes bigint not null check (size_bytes between 1 and 10485760),
  created_at timestamptz not null default now()
);
alter table videoalbum_private.youtube_consent enable row level security;
alter table videoalbum_private.youtube_credentials enable row level security;
alter table videoalbum_private.youtube_upload_probe enable row level security;
revoke all on all tables in schema videoalbum_private from public, anon, authenticated;

create function public.yt_probe_start(p_owner uuid, p_hash text, p_verifier text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from videoalbum_private.youtube_consent where owner_id = p_owner or expires_at < now();
  insert into videoalbum_private.youtube_consent(owner_id,state_hash,verifier) values(p_owner,p_hash,p_verifier);
end $$;
create function public.yt_probe_consume(p_owner uuid, p_hash text)
returns table(verifier text) language sql security definer set search_path = '' as $$
  delete from videoalbum_private.youtube_consent
  where owner_id=p_owner and state_hash=p_hash and expires_at>now() returning verifier
$$;
create function public.yt_probe_save(p_owner uuid, p_cipher text, p_channel text, p_title text)
returns void language sql security definer set search_path = '' as $$
  insert into videoalbum_private.youtube_credentials values(p_owner,p_cipher,p_channel,p_title)
  on conflict(owner_id) do update set refresh_cipher=excluded.refresh_cipher,
    channel_id=excluded.channel_id,channel_title=excluded.channel_title
$$;
create function public.yt_probe_credentials(p_owner uuid)
returns table(refresh_cipher text, channel_id text, channel_title text)
language sql stable security definer set search_path = '' as $$
  select refresh_cipher,channel_id,channel_title from videoalbum_private.youtube_credentials where owner_id=p_owner
$$;
create function public.yt_probe_forget(p_owner uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from videoalbum_private.youtube_credentials where owner_id=p_owner;
  delete from videoalbum_private.youtube_consent where owner_id=p_owner;
  delete from videoalbum_private.youtube_upload_probe where owner_id=p_owner;
end $$;
create function public.yt_probe_reserve(p_owner uuid, p_job uuid, p_size bigint, p_hash text)
returns void language sql security definer set search_path = '' as $$
  insert into videoalbum_private.youtube_upload_probe(owner_id,job_id,size_bytes,file_sha256) values(p_owner,p_job,p_size,p_hash)
$$;
create function public.yt_probe_session(p_owner uuid, p_job uuid, p_cipher text)
returns void language sql security definer set search_path = '' as $$
  update videoalbum_private.youtube_upload_probe set session_cipher=p_cipher where owner_id=p_owner and job_id=p_job
$$;
create function public.yt_probe_job(p_owner uuid)
returns table(job_id uuid, session_cipher text, size_bytes bigint, file_sha256 text, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select job_id,session_cipher,size_bytes,file_sha256,created_at from videoalbum_private.youtube_upload_probe where owner_id=p_owner
$$;
create function public.yt_probe_clear_job(p_owner uuid)
returns void language sql security definer set search_path = '' as $$
  delete from videoalbum_private.youtube_upload_probe where owner_id=p_owner
$$;

-- Postgres grants function EXECUTE to PUBLIC by default. Override every RPC.
revoke all on function public.yt_probe_start(uuid,text,text), public.yt_probe_consume(uuid,text),
  public.yt_probe_save(uuid,text,text,text), public.yt_probe_credentials(uuid),
  public.yt_probe_forget(uuid), public.yt_probe_reserve(uuid,uuid,bigint,text),
  public.yt_probe_session(uuid,uuid,text), public.yt_probe_job(uuid), public.yt_probe_clear_job(uuid)
  from public, anon, authenticated;
grant execute on function public.yt_probe_start(uuid,text,text), public.yt_probe_consume(uuid,text),
  public.yt_probe_save(uuid,text,text,text), public.yt_probe_credentials(uuid),
  public.yt_probe_forget(uuid), public.yt_probe_reserve(uuid,uuid,bigint,text),
  public.yt_probe_session(uuid,uuid,text), public.yt_probe_job(uuid), public.yt_probe_clear_job(uuid)
  to service_role;
