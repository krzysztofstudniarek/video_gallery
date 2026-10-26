import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import type { RuntimeConfig } from "./youtube/config.ts";
import { ActionError } from "./youtube/errors.ts";

export async function requireUser(
  request: Request,
  config: RuntimeConfig,
  send: typeof fetch = fetch,
  allowDeletion = false,
) {
  const token = request.headers.get("Authorization")?.match(/^Bearer (\S+)$/)?.[1];
  if (!token) throw new ActionError("sign_in_required", 401);
  const client = createClient(config.supabaseUrl, config.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: send, headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: { user }, error } = await client.auth.getUser(token);
  if (error?.status && error.status >= 500) throw new ActionError("auth_unavailable", 503);
  if (error || !user) throw new ActionError("sign_in_required", 401);
  const state = await client.rpc("current_app_session");
  if (state.error) throw new ActionError("auth_unavailable", 503);
  if (!state.data?.active) throw new ActionError("sign_in_required", 401);
  if (state.data.deletion_requested && !allowDeletion) {
    throw new ActionError("account_deleting", 403);
  }
  return { client, user, deletionRequested: state.data.deletion_requested === true };
}
