import { youtubeHandler } from "../supabase/functions/_shared/youtube-handler.ts";
import { base64, unseal } from "../supabase/functions/_shared/youtube/crypto.ts";
const owner = "00000000-0000-4000-8000-000000000014";
const key = base64(new Uint8Array(32).fill(14));
function assert(value: unknown): asserts value {
  if (!value) throw new Error("Assertion failed");
}
function backend() {
  let state: Record<string, string> | null = null;
  let credential: Record<string, string> | null = null;
  let live = false, revokeFails = false, missingScopes = false, interrupt = false;
  let exchanges = 0, revocations = 0;
  let pending: Record<string, string>[] = [];
  const env: Record<string, string> = {
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_ANON_KEY: "synthetic-anon",
    SUPABASE_SERVICE_ROLE_KEY: "synthetic-admin",
    FRONTEND_ORIGIN: "https://example.test",
    YOUTUBE_CLIENT_ID: "client",
    YOUTUBE_CLIENT_SECRET: "secret",
    YOUTUBE_REDIRECT_URI: "https://example.test/?youtube_callback=1",
    YOUTUBE_TOKEN_ACTIVE_KEY_ID: "current",
    YOUTUBE_TOKEN_KEYS_JSON: JSON.stringify({ current: key }),
  };
  const send: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/auth/v1/user") {
      return Response.json({
        id: new Headers(init?.headers).get("Authorization") === "Bearer other" ? "other" : owner,
      });
    }
    const body = url.pathname.includes("/rpc/") ? JSON.parse(String(init?.body)) : {};
    const name = url.pathname.split("/").pop();
    if (name === "current_app_session") {
      return Response.json({ active: true, deletion_requested: false });
    }
    if (name === "start_youtube_workflow") {
      assert(body.p_owner === owner && /^[0-9a-f]{64}$/.test(body.p_hash));
      assert(!body.p_cipher.includes("verifier"));
      state = body;
      live = true;
      return Response.json("2026-11-12T12:00:00Z");
    }
    if (name === "consume_youtube_workflow") {
      if (!state || body.p_owner !== owner || body.p_hash !== state.p_hash || !live) {
        return Response.json([]);
      }
      const result = {
        workflow_id: state.p_workflow,
        verifier_cipher: state.p_cipher,
        key_id: state.p_key_id,
      };
      state = null;
      return Response.json([result]);
    }
    if (name === "save_youtube_workflow") {
      if (!live) return Response.json({ message: "Workflow unavailable" }, { status: 409 });
      assert(body.p_owner === owner);
      assert(
        await unseal(key, owner, `workflow:${body.p_workflow}:refresh:current`, body.p_cipher) ===
          "synthetic-refresh",
      );
      credential = {
        workflow_id: body.p_workflow,
        channel_id: body.p_channel,
        refresh_cipher: body.p_cipher,
        key_id: "current",
        expires_at: "2099-01-01T00:00:00Z",
      };
      return Response.json(null);
    }
    if (name === "channel_library_context") {
      return Response.json(live && credential ? [credential] : []);
    }
    if (name === "disconnect_youtube_workflows") {
      if (credential) pending.push({ ...credential, id: "revocation", owner_id: owner });
      credential = null;
      live = false;
      state = null;
      return Response.json(null);
    }
    if (name === "pending_provider_revocations") return Response.json(pending);
    if (name === "note_provider_revocation_attempt") return Response.json(null);
    if (name === "finish_provider_revocation") {
      pending = [];
      return Response.json(null);
    }
    if (url.href === "https://oauth2.googleapis.com/token") {
      exchanges++;
      if (interrupt) live = false;
      return Response.json({
        access_token: "synthetic-access",
        refresh_token: "synthetic-refresh",
        scope: missingScopes
          ? ""
          : "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly",
      });
    }
    if (url.pathname === "/youtube/v3/channels") {
      return Response.json({
        items: [{ id: "UC" + "x".repeat(22), snippet: { title: "Synthetic" } }],
      });
    }
    if (url.pathname === "/revoke") {
      assert(!live && !credential);
      revocations++;
      return new Response(null, { status: revokeFails ? 503 : 200 });
    }
    throw new Error("Unexpected synthetic call");
  };
  const handler = youtubeHandler((name) => env[name], send);
  const call = (body: Record<string, unknown>, who = "owner") =>
    handler(
      new Request("https://project.supabase.co/functions/v1/youtube", {
        method: "POST",
        headers: { Authorization: `Bearer ${who}`, Origin: env.FRONTEND_ORIGIN },
        body: JSON.stringify(body),
      }),
    );
  return {
    call,
    env,
    exchanges: () => exchanges,
    revocations: () => revocations,
    revokeFails: () => {
      revokeFails = true;
    },
    missingScopes: () => {
      missingScopes = true;
    },
    interrupt: () => {
      interrupt = true;
    },
    expire: () => {
      live = false;
    },
  };
}
async function start(b: ReturnType<typeof backend>) {
  const result = await b.call({ action: "connect", owner_id: "forged" });
  assert(result.ok);
  const url = new URL((await result.json()).authorization_url);
  assert(url.searchParams.get("code_challenge_method") === "S256");
  return url.searchParams.get("state");
}
Deno.test("workflow consent uses encrypted PKCE, owner-bound one-use state, and the library credential envelope", async () => {
  const b = backend(), state = await start(b);
  assert((await b.call({ action: "complete", state, code: "synthetic" }, "other")).status === 400);
  assert(b.exchanges() === 0);
  const completed = await b.call({ action: "complete", state, code: "synthetic" });
  assert(completed.ok && !(await completed.text()).includes("refresh"));
  assert((await b.call({ action: "complete", state, code: "synthetic" })).status === 400);
  assert(b.exchanges() === 1);
  const status = await b.call({ action: "connection" });
  const body = await status.text();
  assert(body.includes('"connected":true') && !body.includes("cipher"));
});
Deno.test("workflow disconnect blocks local use before remote revocation and retries safely on provider failure", async () => {
  const b = backend(), state = await start(b);
  assert((await b.call({ action: "complete", state, code: "synthetic" })).ok);
  b.revokeFails();
  const disconnected = await b.call({ action: "workflow_disconnect" });
  assert(disconnected.ok && (await disconnected.json()).provider_revocation_pending);
  assert(!(await (await b.call({ action: "connection" })).json()).connected);
  assert(b.revocations() === 1);
  assert((await b.call({ action: "complete", state, code: "synthetic" })).status === 400);
  assert((await b.call({ action: "workflow_disconnect" })).ok && b.revocations() === 2);
});
Deno.test("expired workflows and disconnect during exchange cannot be revived by a callback", async () => {
  const b = backend(), state = await start(b);
  b.expire();
  assert(
    (await b.call({ action: "complete", state, code: "synthetic" })).status === 400 &&
      b.exchanges() === 0,
  );
  const c = backend(), state2 = await start(c);
  c.interrupt();
  assert((await c.call({ action: "complete", state: state2, code: "synthetic" })).status === 409);
  assert(!(await (await c.call({ action: "connection" })).json()).connected);
});
Deno.test("missing scopes and invalid workflow key configuration fail closed without exposing provider data", async () => {
  const b = backend(), state = await start(b);
  b.missingScopes();
  const denied = await b.call({ action: "complete", state, code: "synthetic" });
  assert(denied.status === 409 && (await denied.json()).error === "consent_missing_permissions");
  assert(!(await (await b.call({ action: "connection" })).json()).connected);
  const c = backend();
  c.env.YOUTUBE_TOKEN_ACTIVE_KEY_ID = "absent";
  assert((await c.call({ action: "connect" })).status === 503 && c.exchanges() === 0);
});

Deno.test("empty or expired revocation material never implies the Google grant was revoked", async () => {
  const b = backend();
  const result = await b.call({ action: "workflow_disconnect" });
  const body = await result.json();
  assert(result.ok && body.disconnected && !body.provider_revocation_confirmed);
  assert(b.revocations() === 0);
});
