import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import { requireUser } from "./auth.ts";
import { ChannelLibrary, validVideoId } from "./channel-library.ts";
import { type Env, runtimeConfig } from "./youtube/config.ts";
import { seal, unseal } from "./youtube/crypto.ts";
import { ActionError } from "./youtube/errors.ts";
import { corsHeaders, readJson } from "./youtube/http.ts";

type Connection = {
  workflow_id: string;
  expires_at: string;
  channel_id: string;
  refresh_cipher: string;
  key_id: string;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function channelLibraryHandler(env: Env, send: typeof fetch = fetch) {
  const config = runtimeConfig(env);
  const headers = { ...corsHeaders(config.origin), "Cache-Control": "no-store" };
  const reply = (body: unknown, status = 200) => Response.json(body, { status, headers });
  return async (request: Request) => {
    if (request.headers.has("Origin") && request.headers.get("Origin") !== config.origin) {
      return reply({ error: "origin_denied" }, 403);
    }
    if (request.method === "OPTIONS") return new Response(null, { headers });
    if (request.method !== "POST") return reply({ error: "method_not_allowed" }, 405);
    try {
      const { user } = await requireUser(request, config, send);
      const input = await readJson(request) as Record<string, unknown>;
      if (
        !input || typeof input !== "object" || Array.isArray(input) ||
        !["list", "verify"].includes(String(input.action)) ||
        (input.workflowId !== undefined &&
          (typeof input.workflowId !== "string" || input.workflowId.length !== 36 ||
            !uuid.test(input.workflowId))) ||
        (input.pageToken !== undefined &&
          (typeof input.pageToken !== "string" || input.pageToken.length > 512))
      ) {
        throw new ActionError("invalid_request", 400);
      }
      const verify = input.action === "verify";
      if (input.pageToken !== undefined && typeof input.workflowId !== "string") {
        throw new ActionError("invalid_request", 400);
      }
      if (
        verify && (typeof input.workflowId !== "string" || !Array.isArray(input.videoIds) ||
          input.videoIds.length < 1 || input.videoIds.length > 50 ||
          !input.videoIds.every(validVideoId) ||
          new Set(input.videoIds).size !== input.videoIds.length)
      ) {
        throw new ActionError("invalid_request", 400);
      }
      const admin = createClient(config.supabaseUrl, config.serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { fetch: send },
      });
      const context = async (workflow?: string): Promise<Connection | null> => {
        const { data, error } = await admin.rpc("channel_library_context", {
          p_owner: user.id,
          p_workflow: workflow ?? null,
        });
        if (error) throw new ActionError("channel_library_unavailable", 503);
        const row = data?.[0];
        return row && Date.parse(row.expires_at) > Date.now() ? row : null;
      };
      const connection = await context(input.workflowId as string | undefined);
      if (!connection) {
        if (verify || input.workflowId) throw new ActionError("channel_connection_expired", 409);
        return reply({ connected: false, items: [], nextPageToken: null });
      }
      const clientId = env("YOUTUBE_CLIENT_ID"), secret = env("YOUTUBE_CLIENT_SECRET");
      const keys = JSON.parse(env("YOUTUBE_TOKEN_KEYS_JSON") ?? "{}");
      const key = keys[connection.key_id];
      if (!clientId || !secret || typeof key !== "string") {
        throw new ActionError("channel_library_not_configured", 503);
      }
      const refresh = await unseal(
        key,
        user.id,
        `workflow:${connection.workflow_id}:refresh:${connection.key_id}`,
        connection.refresh_cipher,
      );
      const providerSend: typeof fetch = async (url, init) => {
        const live = await context(connection.workflow_id);
        if (!live || live.channel_id !== connection.channel_id) {
          throw new ActionError("channel_connection_expired", 409);
        }
        return send(url, init);
      };
      const response = await providerSend("https://oauth2.googleapis.com/token", {
        method: "POST",
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: secret,
          grant_type: "refresh_token",
          refresh_token: refresh,
        }),
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      });
      const token = await response.json();
      if (!response.ok) {
        if (token.error === "invalid_grant") {
          // Erase unusable workflow capabilities without waiting for a provider revocation call.
          const cleanup = await admin.rpc("finish_upload_workflow", {
            p_owner: user.id,
            p_workflow: connection.workflow_id,
          });
          if (cleanup.error) throw new ActionError("channel_library_unavailable", 503);
          throw new ActionError("reconnect_youtube", 409);
        }
        throw new ActionError("channel_library_unavailable", 502);
      }
      if (typeof token.access_token !== "string" || !token.access_token) {
        throw new ActionError("channel_library_unavailable", 502);
      }
      if (
        typeof token.refresh_token === "string" && token.refresh_token &&
        token.refresh_token !== refresh
      ) {
        const rotated = await admin.rpc("rotate_channel_library_credential", {
          p_owner: user.id,
          p_workflow: connection.workflow_id,
          p_previous_cipher: connection.refresh_cipher,
          p_cipher: await seal(
            key,
            user.id,
            `workflow:${connection.workflow_id}:refresh:${connection.key_id}`,
            token.refresh_token,
          ),
          p_key_id: connection.key_id,
        });
        if (rotated.error || rotated.data !== true) {
          throw new ActionError("channel_connection_expired", 409);
        }
      }
      if (!await context(connection.workflow_id)) {
        throw new ActionError("channel_connection_expired", 409);
      }
      const library = new ChannelLibrary(token.access_token, connection.channel_id, providerSend);
      const result = verify
        ? await library.verify(input.videoIds as string[])
        : await library.page(input.pageToken as string | undefined);
      const live = await context(connection.workflow_id);
      if (!live || live.channel_id !== connection.channel_id) {
        throw new ActionError("channel_connection_expired", 409);
      }
      return reply({
        connected: true,
        workflowId: connection.workflow_id,
        expiresAt: connection.expires_at,
        ...result,
      });
    } catch (error) {
      if (error instanceof ActionError) return reply({ error: error.code }, error.status);
      return reply({
        error: error instanceof Error && error.message === "reconnect_youtube"
          ? "reconnect_youtube"
          : "channel_library_unavailable",
      }, 502);
    }
  };
}
