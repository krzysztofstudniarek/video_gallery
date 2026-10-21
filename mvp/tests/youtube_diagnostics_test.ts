import { GoogleClient } from "../supabase/functions/_shared/youtube/google-client.ts";
const config = {
  clientId: "synthetic",
  secret: "synthetic",
  encryptionKey: "unused",
  redirect: "https://example.test/?youtube_callback=1",
};
const session = "https://www.googleapis.com/upload/youtube/v3/videos?upload_id=sensitive-session";
function assert(value: unknown): asserts value {
  if (!value) throw new Error("Assertion failed");
}

Deno.test("session diagnostics use only preflight and empty PUT with the configured origin", async () => {
  const methods: string[] = [];
  const send: typeof fetch = async (url, options) => {
    assert(url === session && !options?.body);
    methods.push(options!.method!);
    const headers = new Headers(options?.headers);
    assert(headers.get("Origin") === "https://example.test");
    assert(!headers.has("Authorization"));
    if (options?.method === "OPTIONS") {
      assert(headers.get("Access-Control-Request-Method") === "PUT");
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "PUT",
          "Access-Control-Allow-Headers": "content-range, content-type",
        },
      });
    }
    assert(headers.get("Content-Range") === "bytes */12");
    return new Response(null, {
      status: 308,
      headers: {
        Range: "bytes=0-4",
        "Access-Control-Allow-Origin": "https://example.test",
        "Access-Control-Expose-Headers": "Range",
      },
    });
  };
  const result = await new GoogleClient(config, send).inspectSession(session, 12);
  assert(methods.join(",") === "OPTIONS,PUT");
  assert(result.accepted_bytes === 5 && !result.complete);
  assert(
    result.cors.response_origin_allowed && result.cors.headers_allowed && result.cors.range_exposed,
  );
  assert(!JSON.stringify(result).includes("sensitive-session"));
});
Deno.test("completed session recovers only a validated video ID without exposing the provider body", async () => {
  const send: typeof fetch = async (_url, options) =>
    options?.method === "OPTIONS"
      ? new Response(null, { status: 204 })
      : Response.json({ id: "synthetic01", sensitive: "provider-private-detail" });
  const result = await new GoogleClient(config, send).inspectSession(session, 12);
  assert(result.complete && result.video_id === "synthetic01");
  assert(!JSON.stringify(result).includes("provider-private-detail"));
});
Deno.test("expired session and absent CORS headers are reported without claiming a CORS cause", async () => {
  const send: typeof fetch = async (_url, options) =>
    new Response("sensitive-provider-detail", {
      status: options?.method === "OPTIONS" ? 403 : 404,
    });
  const result = await new GoogleClient(config, send).inspectSession(session, 12);
  assert(result.session_status === 404 && !result.complete);
  assert(!result.cors.preflight_origin_allowed && !result.cors.response_origin_allowed);
  assert(!JSON.stringify(result).includes("sensitive-provider-detail"));
});
Deno.test("new upload initiation includes trusted origin and explicit Unlisted metadata", async () => {
  const send: typeof fetch = async (_url, options) => {
    assert(new Headers(options?.headers).get("Origin") === "https://example.test");
    assert(JSON.parse(String(options?.body)).status.privacyStatus === "unlisted");
    return new Response(null, { headers: { Location: session } });
  };
  assert(
    await new GoogleClient(config, send).initiate("synthetic-token", "synthetic-job", 12, false) ===
      session,
  );
});
