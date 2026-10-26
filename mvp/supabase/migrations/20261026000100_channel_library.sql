-- Read-only bridge for #5/#14. Never expose credentials to an authenticated client.
create function public.channel_library_context(p_owner uuid, p_workflow uuid default null)
returns table(workflow_id uuid, expires_at timestamptz, channel_id text, refresh_cipher text, key_id text)
language sql stable security definer set search_path = '' as $$
  select w.id, w.expires_at, c.channel_id, k.refresh_cipher, k.key_id
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

-- Refresh-token rotation is a compare-and-swap within the same immutable workflow deadline.
create function public.rotate_channel_library_credential(
  p_owner uuid, p_workflow uuid, p_previous_cipher text, p_cipher text, p_key_id text
) returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update videoalbum_private.workflow_credentials k set refresh_cipher = p_cipher
  from public.upload_workflows w, public.profiles p
  where k.workflow_id = p_workflow and k.owner_id = p_owner
    and k.refresh_cipher = p_previous_cipher and k.key_id = p_key_id
    and k.revocation_requested_at is null and w.id = k.workflow_id and w.owner_id = k.owner_id
    and w.expires_at > clock_timestamp() and p.owner_id = k.owner_id and p.deletion_requested_at is null;
  return found;
end $$;
revoke all on function public.rotate_channel_library_credential(uuid,uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.rotate_channel_library_credential(uuid,uuid,text,text,text) to service_role;
