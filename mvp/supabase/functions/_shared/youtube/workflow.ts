import type { SupabaseClient } from "npm:@supabase/supabase-js@2.118.0";
import { revokePending } from "../account-handler.ts";
import { consentConfig, type Env, requireConsent } from "./config.ts";
import { hash, randomSecret, seal, unseal } from "./crypto.ts";
import { ActionError } from "./errors.ts";
import { GoogleClient } from "./google-client.ts";
import { authorizeUrl, scopes } from "./google.ts";

export async function workflowAction(
  input: Record<string, unknown>,
  admin: SupabaseClient,
  owner: string,
  env: Env,
  origin: string,
  send: typeof fetch,
) {
  async function rpc(name: string, args: Record<string, unknown> = {}) {
    const result = await admin.rpc(name, { p_owner: owner, ...args });
    if (result.error) throw new ActionError("youtube_workflow_unavailable", 409);
    return result.data;
  }
  if (input.action === "connection") {
    const row = (await rpc("channel_library_context"))?.[0];
    return {
      connected: !!row,
      channel: row ? { id: row.channel_id, title: row.channel_title } : null,
      expiresAt: row?.expires_at ?? null,
    };
  }
  if (input.action === "workflow_disconnect") {
    await rpc("disconnect_youtube_workflows");
    const queued = await admin.rpc("pending_provider_revocations", { p_owner: owner });
    const hadMaterial = !queued.error && queued.data.length > 0;
    const revoked = await revokePending(admin, env, send, owner);
    return {
      disconnected: true,
      provider_revocation_pending: !revoked,
      provider_revocation_confirmed: hadMaterial && revoked,
    };
  }
  // The historical probe key is independent of the workflow key ring.
  const config = requireConsent(consentConfig(
    (name) => name === "YOUTUBE_TOKEN_KEY_B64" ? "workflow-key-ring" : env(name),
    origin,
  ));
  const redirect = new URL(config.redirect);
  if (redirect.pathname !== "/" || redirect.search !== "?youtube_callback=1" || redirect.hash) {
    throw new ActionError("youtube_not_configured", 503);
  }
  const keys = JSON.parse(env("YOUTUBE_TOKEN_KEYS_JSON") ?? "{}");
  const active = env("YOUTUBE_TOKEN_ACTIVE_KEY_ID");
  const getKey = (id: string) => {
    if (!Object.hasOwn(keys, id) || typeof keys[id] !== "string") {
      throw new ActionError("youtube_not_configured", 503);
    }
    return keys[id] as string;
  };
  const google = new GoogleClient(config, send);
  const digest = async (state: string) => {
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(state));
    return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
  };
  if (input.action === "connect") {
    if (!active || !/^[A-Za-z0-9_-]{1,100}$/.test(active)) {
      throw new ActionError("youtube_not_configured", 503);
    }
    const state = `w_${randomSecret()}`, verifier = randomSecret(), workflow = crypto.randomUUID();
    const cipher = await seal(
      getKey(active),
      owner,
      `workflow:${workflow}:verifier:${active}`,
      verifier,
    );
    await rpc("start_youtube_workflow", {
      p_hash: await digest(state),
      p_cipher: cipher,
      p_key_id: active,
      p_workflow: workflow,
    });
    return {
      authorization_url: authorizeUrl(
        config.clientId,
        config.redirect,
        state,
        await hash(verifier),
      ),
    };
  }
  if (
    input.action !== "complete" || typeof input.state !== "string" ||
    !/^w_[A-Za-z0-9_-]{43}$/.test(input.state) ||
    typeof input.code !== "string" || !input.code || input.code.length > 4096
  ) throw new ActionError("invalid_consent", 400);
  const attempt = (await rpc("consume_youtube_workflow", { p_hash: await digest(input.state) }))
    ?.[0];
  if (!attempt) throw new ActionError("consent_expired_or_used", 400);
  const kind = (purpose: string) => `workflow:${attempt.workflow_id}:${purpose}:${attempt.key_id}`;
  const key = getKey(attempt.key_id);
  const tokens = await google.exchange(
    input.code,
    await unseal(key, owner, kind("verifier"), attempt.verifier_cipher),
  );
  if (
    !scopes.every((scope) => String(tokens.scope ?? "").split(" ").includes(scope)) ||
    !tokens.refresh_token
  ) {
    throw new ActionError("consent_missing_permissions", 409);
  }
  const channel = await google.channel(tokens.access_token);
  await rpc("save_youtube_workflow", {
    p_workflow: attempt.workflow_id,
    p_cipher: await seal(key, owner, kind("refresh"), tokens.refresh_token),
    p_key_id: attempt.key_id,
    p_channel: channel.id,
    p_title: channel.title,
  });
  return { connected: true, channel };
}
