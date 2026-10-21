import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import { dispatchAction } from "./youtube/actions.ts";
import { consentConfig, type Env, runtimeConfig } from "./youtube/config.ts";
import { safeError } from "./youtube/errors.ts";
import { corsHeaders, readJson } from "./youtube/http.ts";
import { parseAction } from "./youtube/inputs.ts";
import { YoutubeRepository } from "./youtube/repository.ts";

export function youtubeHandler(env: Env, send: typeof fetch = fetch) {
  // Validate deployment configuration at startup, including explicit local origins.
  const config = runtimeConfig(env);
  const headers = corsHeaders(config.origin);
  const reply = (body: unknown, status = 200) => Response.json(body, { status, headers });
  return async (request: Request) => {
    if (request.headers.get("Origin") && request.headers.get("Origin") !== config.origin) {
      return reply({ error: "origin_denied" }, 403);
    }
    if (request.method === "OPTIONS") return new Response(null, { headers });
    if (request.method !== "POST") return reply({ error: "method_not_allowed" }, 405);
    const token = request.headers.get("Authorization")?.match(/^Bearer (.+)$/)?.[1];
    if (!token) return reply({ error: "sign_in_required" }, 401);
    try {
      const options = { auth: { persistSession: false }, global: { fetch: send } };
      const auth = createClient(config.supabaseUrl, config.anonKey, options);
      const { data: { user }, error } = await auth.auth.getUser(token);
      if (error || !user) return reply({ error: "sign_in_required" }, 401);
      const input = parseAction(await readJson(request));
      const repository = new YoutubeRepository(
        createClient(config.supabaseUrl, config.serviceKey, options),
        user.id,
      );
      return reply(
        await dispatchAction(input, repository, consentConfig(env, config.origin), send),
      );
    } catch (error) {
      // No provider responses, OAuth codes, tokens or session URLs in logs/errors.
      const result = safeError(error);
      return reply(result.body, result.status);
    }
  };
}
