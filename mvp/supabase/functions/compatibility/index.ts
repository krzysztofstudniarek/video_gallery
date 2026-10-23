import { requireUser } from "../_shared/auth.ts";
import { encryptionProbe, oauthProbe, syntheticFetch } from "../_shared/probes.ts";
import { runtimeConfig } from "../_shared/youtube/config.ts";
import { ActionError } from "../_shared/youtube/errors.ts";
import { corsHeaders } from "../_shared/youtube/http.ts";

const config = runtimeConfig((name) => Deno.env.get(name));
const headers = corsHeaders(config.origin);
Deno.serve(async (request) => {
  if (request.headers.has("Origin") && request.headers.get("Origin") !== config.origin) {
    return Response.json({ error: "origin_denied" }, { status: 403, headers });
  }
  if (request.method === "OPTIONS") return new Response(null, { headers });
  if (request.method !== "POST") return new Response(null, { status: 405, headers });
  try {
    const { client } = await requireUser(request, config);
    const { data, error: readError } = await client.from("spike_items").select("id").limit(1);
    if (readError || !data) throw new Error("rls_read_failed");
    const outbound = await fetch("https://www.googleapis.com/oauth2/v3/certs", {
      signal: AbortSignal.timeout(10000),
    });
    if (!outbound.ok) throw new Error("https_failed");
    await outbound.body?.cancel();
    return Response.json({
      jwt_verified: true,
      postgres_read: true,
      https: true,
      aes_gcm: await encryptionProbe(),
      oauth_synthetic: await oauthProbe(syntheticFetch),
    }, { headers });
  } catch (error) {
    if (error instanceof ActionError) {
      return Response.json({ error: error.code }, { status: error.status, headers });
    }
    return Response.json({ error: "probe_failed" }, { status: 502, headers });
  }
});
