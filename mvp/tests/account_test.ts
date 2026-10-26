import { accountHandler } from "../supabase/functions/_shared/account-handler.ts";
import { seal } from "../supabase/functions/_shared/youtube/crypto.ts";

function assert(value: unknown): asserts value {
  if (!value) throw new Error("Assertion failed");
}
const owner = "00000000-0000-4000-8000-000000000001";
const key = btoa("k".repeat(32));
const config: Record<string, string> = {
  FRONTEND_ORIGIN: "https://example.test",
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_ANON_KEY: "synthetic",
  SUPABASE_SERVICE_ROLE_KEY: "synthetic-service",
  YOUTUBE_TOKEN_KEY_B64: key,
};
type Options = {
  active?: boolean;
  deleting?: boolean;
  authFails?: boolean;
  deleteFails?: boolean;
  revokeFails?: boolean;
  cipher?: string;
};
function fixture(options: Options = {}) {
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  let pending = options.cipher
    ? [{
      id: "task",
      owner_id: owner,
      refresh_cipher: options.cipher,
      key_id: "probe-v1",
      workflow_id: null,
    }]
    : [];
  const send: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
    calls.push({ path: url.pathname, body });
    if (url.hostname === "oauth2.googleapis.com") {
      if (options.revokeFails) throw new Error("sensitive provider response");
      assert(String(init?.body).includes("token="));
      return new Response(null, { status: 200 });
    }
    if (url.pathname === "/auth/v1/user") {
      return options.authFails
        ? Response.json({ msg: "invalid JWT" }, { status: 401 })
        : Response.json({ id: owner });
    }
    if (url.pathname === `/auth/v1/admin/users/${owner}`) {
      return options.deleteFails
        ? Response.json({ msg: "temporary" }, { status: 500 })
        : Response.json({ id: owner });
    }
    const name = url.pathname.split("/").at(-1);
    if (name === "current_app_session") {
      return Response.json({
        active: options.active ?? true,
        deletion_requested: options.deleting ?? false,
      });
    }
    if (name === "pending_provider_revocations") return Response.json(pending);
    if (name === "finish_provider_revocation") pending = [];
    if (name === "pending_account_deletions") return Response.json([{ owner_id: owner }]);
    return Response.json(null);
  };
  return { calls, handler: accountHandler((name) => config[name], send) };
}
function request(body: unknown, token = "synthetic-user", origin = config.FRONTEND_ORIGIN) {
  return new Request("https://project.supabase.co/functions/v1/account", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Origin: origin,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

Deno.test("account rejects invalid JWT, revoked sessions, foreign origin and anonymous requests before mutation", async () => {
  for (const options of [{ authFails: true }, { active: false }]) {
    const { handler, calls } = fixture(options);
    assert((await handler(request({ action: "delete", confirm: true }))).status === 401);
    assert(!calls.some((call) => call.path.includes("begin_account_deletion")));
  }
  const { handler, calls } = fixture();
  assert(
    (await handler(request({ action: "delete", confirm: true }, "user", "https://attacker.test")))
      .status === 403,
  );
  assert((await handler(new Request("https://example.test", { method: "POST" }))).status === 401);
  assert(calls.length === 0);
});

Deno.test("deletion requires explicit confirmation and always derives owner from verified identity", async () => {
  const { handler, calls } = fixture();
  assert((await handler(request({ action: "delete" }))).status === 400);
  const response = await handler(
    request({ action: "delete", confirm: true, owner_id: "another-owner" }),
  );
  assert(response.status === 200 && (await response.json()).deleted);
  const begin = calls.find((call) => call.path.endsWith("begin_account_deletion"));
  assert(begin?.body.p_owner === owner);
  assert(
    calls.findIndex((call) => call.path.endsWith("begin_account_deletion")) <
      calls.findIndex((call) => call.path.includes("/admin/users/")),
  );
});

Deno.test("Google failure cannot prevent identity deletion and is reported as pending without leaking details", async () => {
  const cipher = await seal(key, owner, "refresh", "sensitive-refresh-token");
  const { handler } = fixture({ cipher, revokeFails: true });
  const response = await handler(request({ action: "delete", confirm: true }));
  const body = await response.text();
  assert(
    response.status === 200 && JSON.parse(body).deleted &&
      JSON.parse(body).provider_revocation_pending,
  );
  assert(!body.includes("sensitive") && !body.includes(cipher));
});

Deno.test("pending identity deletion can retry; provider revocation clears only confirmed tasks", async () => {
  const cipher = await seal(key, owner, "refresh", "synthetic-token");
  const { handler, calls } = fixture({ cipher, deleteFails: true, deleting: true });
  const response = await handler(request({ action: "delete", confirm: true }));
  const body = await response.json();
  assert(
    response.status === 202 && !body.deleted && body.deletion_requested &&
      !body.provider_revocation_pending,
  );
  assert(calls.some((call) => call.path.endsWith("finish_provider_revocation")));
});

Deno.test("ordinary users cannot run maintenance; service maintenance retries queued identities", async () => {
  const { handler, calls } = fixture();
  assert((await handler(request({ action: "maintenance" }))).status === 400);
  assert(!calls.some((call) => call.path.endsWith("pending_account_deletions")));
  const result = await handler(
    request({ action: "maintenance" }, config.SUPABASE_SERVICE_ROLE_KEY),
  );
  assert(result.status === 200 && (await result.json()).processed === 1);
});

Deno.test("deleting account status stays blocked and never recreates its profile", async () => {
  const { handler, calls } = fixture({ deleting: true });
  const response = await handler(request({ action: "status" }));
  assert((await response.json()).deletion_requested);
  assert(!calls.some((call) => call.path.endsWith("ensure_app_profile")));
});
