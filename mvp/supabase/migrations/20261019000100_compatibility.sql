-- Disposable spike schema, not the final album/upload model.
create table public.spike_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  caption text not null check (length(caption) <= 200),
  video_id text not null check (video_id ~ '^[A-Za-z0-9_-]{11}$'),
  share_token uuid not null unique default gen_random_uuid(),
  sharing_enabled boolean not null default false
);
alter table public.spike_items enable row level security;
revoke all on public.spike_items from anon;
grant select, insert, update, delete on public.spike_items to authenticated;
create policy owner_only on public.spike_items to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

-- Called by the backend only. No anon/authenticated EXECUTE and no table reads.
create function public.resolve_spike_share(token uuid)
returns table(video_id text)
language sql stable security definer set search_path = ''
as $$
  select i.video_id from public.spike_items i
  where i.share_token = token and i.sharing_enabled = true limit 1
$$;
revoke all on function public.resolve_spike_share(uuid) from public, anon, authenticated;
grant execute on function public.resolve_spike_share(uuid) to service_role;
