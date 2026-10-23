import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.118.0";
import { requireUser } from "./auth.ts";
import { type Env, runtimeConfig } from "./youtube/config.ts";
import { unseal } from "./youtube/crypto.ts";
import { ActionError, safeError } from "./youtube/errors.ts";
import { corsHeaders, readJson } from "./youtube/http.ts";

type Revocation = {
  id: string;
  owner_id: string;
  refresh_cipher: string;
  key_id: string;
  workflow_id: string | null;
};

async function revokePending(admin: SupabaseClient, env: Env, send: typeof fetch, owner?: string) {
  const { data, error } = await admin.rpc("pending_provider_revocations", {
    p_owner: owner ?? null,
  });
  if (error) return false;
  const results = await Promise.all((data as Revocation[]).map(async (row) => {
    try {
      if ((await admin.rpc("note_provider_revocation_attempt", { p_id: row.id })).error) {
        return false;
      }
      const keys = JSON.parse(env("YOUTUBE_TOKEN_KEYS_JSON") ?? "{}");
      const key = row.key_id === "probe-v1" ? env("YOUTUBE_TOKEN_KEY_B64") : keys[row.key_id];
      if (typeof key !== "string") return false;
      // Workflow credentials bind purpose, workflow and key version as well as owner.
      const kind = row.workflow_id
        ? `workflow:${row.workflow_id}:refresh:${row.key_id}`
        : "refresh";
      const token = await unseal(key, row.owner_id, kind, row.refresh_cipher);
      const response = await send("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        body: new URLSearchParams({ token }),
        redirect: "error",
        signal: AbortSignal.timeout(5000),
      });
      // An invalid token is already revoked. Never return/log Google's response body.
      const invalid = response.status === 400 && (await response.json()).error === "invalid_token";
      if (!response.ok && !invalid) return false;
      await response.body?.cancel();
      return !(await admin.rpc("finish_provider_revocation", { p_id: row.id })).error;
    } catch {
      return false;
    }
  }));
  // A bounded batch is not evidence that the entire owner's queue was drained.
  const remaining = await admin.rpc("pending_provider_revocations", { p_owner: owner ?? null });
  return results.every(Boolean) && !remaining.error && remaining.data.length === 0;
}

async function deleteIdentity(admin: SupabaseClient, owner: string) {
  if ((await admin.rpc("note_account_deletion_attempt", { p_owner: owner })).error) return false;
  const { error } = await admin.auth.admin.deleteUser(owner);
  // Auth may have succeeded before a previous response was lost.
  if (error && error.status !== 404) return false;
  return !(await admin.rpc("finish_account_deletion", { p_owner: owner })).error;
}

export function accountHandler(env: Env, send: typeof fetch = fetch) {
  const config = runtimeConfig(env);
  const headers = corsHeaders(config.origin);
  const reply = (body: unknown, status = 200) => Response.json(body, { status, headers });
  return async (request: Request) => {
    if (request.headers.has("Origin") && request.headers.get("Origin") !== config.origin) {
      return reply({ error: "origin_denied" }, 403);
    }
    if (request.method === "OPTIONS") return new Response(null, { headers });
    if (request.method !== "POST") return reply({ error: "method_not_allowed" }, 405);
    try {
      const maintenance = request.headers.get("Authorization") === `Bearer ${config.serviceKey}`;
      // Authenticate before reading any request body or using backend privileges.
      const identity = maintenance ? null : await requireUser(request, config, send, true);
      const input = await readJson(request);
      if (!input || typeof input !== "object" || Array.isArray(input)) {
        throw new ActionError("invalid_request", 400);
      }
      const { action, confirm } = input as Record<string, unknown>;
      if (identity && action === "status") {
        if (!identity.deletionRequested) {
          const result = await identity.client.rpc("ensure_app_profile");
          if (result.error) throw new ActionError("account_unavailable", 503);
        }
        return reply({
          user: { id: identity.user.id, email: identity.user.email },
          deletion_requested: identity.deletionRequested,
        });
      }
      if (
        (!maintenance && (action !== "delete" || confirm !== true)) ||
        (maintenance && action !== "maintenance")
      ) {
        throw new ActionError("invalid_request", 400);
      }
      const admin = createClient(config.supabaseUrl, config.serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { fetch: send },
      });
      if (maintenance) {
        const pending = await admin.rpc("pending_account_deletions");
        if (pending.error) throw new Error("maintenance_failed");
        const deleted = await Promise.all(
          pending.data.map((row: { owner_id: string }) => deleteIdentity(admin, row.owner_id)),
        );
        const revoked = await revokePending(admin, env, send);
        const remaining = await admin.rpc("pending_account_deletions");
        return reply({
          processed: deleted.filter(Boolean).length,
          retry_needed: !revoked || deleted.includes(false) || !!remaining.error ||
            remaining.data.length > 0,
        });
      }
      const owner = identity!.user.id;
      const started = await admin.rpc("begin_account_deletion", { p_owner: owner });
      if (started.error) throw new Error("deletion_failed");
      const deleted = await deleteIdentity(admin, owner);
      const revoked = await revokePending(admin, env, send, owner);
      return reply(
        { deleted, deletion_requested: true, provider_revocation_pending: !revoked },
        deleted ? 200 : 202,
      );
    } catch (error) {
      const result = safeError(
        error instanceof ActionError ? error : new ActionError("account_unavailable", 503),
      );
      return reply(result.body, result.status);
    }
  };
}
