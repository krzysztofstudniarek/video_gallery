import { ChannelLibrary } from "../supabase/functions/_shared/channel-library.ts";
import { channelLibraryHandler } from "../supabase/functions/_shared/channel-library-handler.ts";
import { seal, unseal } from "../supabase/functions/_shared/youtube/crypto.ts";

function assert(value: unknown): asserts value {
  if (!value) throw new Error("Assertion failed");
}
const owner = "00000000-0000-4000-8000-000000000001";
const workflow = "10000000-0000-4000-8000-000000000001";
const key = btoa("k".repeat(32));
const config: Record<string, string> = {
  FRONTEND_ORIGIN: "https://example.test",
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_ANON_KEY: "synthetic",
  SUPABASE_SERVICE_ROLE_KEY: "synthetic-service",
  YOUTUBE_CLIENT_ID: "synthetic-client",
  YOUTUBE_CLIENT_SECRET: "sensitive-client-secret",
  YOUTUBE_TOKEN_KEYS_JSON: JSON.stringify({ "test-v1": key }),
};
function video(
  id: string,
  visibility = "unlisted",
  processed = true,
  channel = "synthetic-channel",
) {
  return {
    id,
    snippet: { channelId: channel, title: "Synthetic existing video" },
    status: { privacyStatus: visibility, uploadStatus: processed ? "processed" : "uploaded" },
    processingDetails: { processingStatus: processed ? "succeeded" : "processing" },
  };
}
type Options = {
  missing?: boolean;
  expired?: boolean;
  wrongChannel?: boolean;
  authFails?: boolean;
  inactive?: boolean;
  deleting?: boolean;
  refreshFails?: boolean;
  rotate?: boolean;
  cleanupDuringRead?: boolean;
};
async function fixture(options: Options = {}) {
  const calls: { url: URL; body: Record<string, unknown> }[] = [];
  const cipher = await seal(
    key,
    owner,
    `workflow:${workflow}:refresh:test-v1`,
    "sensitive-refresh",
  );
  let live = !options.missing;
  const send: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const body = typeof init?.body === "string" && init.body.startsWith("{")
      ? JSON.parse(init.body)
      : {};
    calls.push({ url, body });
    if (url.pathname === "/auth/v1/user") {
      return options.authFails
        ? Response.json({ msg: "invalid" }, { status: 401 })
        : Response.json({ id: owner });
    }
    if (url.pathname.endsWith("/current_app_session")) {
      return Response.json({ active: !options.inactive, deletion_requested: !!options.deleting });
    }
    if (url.pathname.endsWith("/channel_library_context")) {
      assert(body.p_owner === owner);
      assert(body.p_workflow === null || body.p_workflow === workflow);
      return Response.json(
        live
          ? [{
            workflow_id: workflow,
            expires_at: new Date(Date.now() + (options.expired ? -1 : 3600000)).toISOString(),
            channel_id: "synthetic-channel",
            refresh_cipher: cipher,
            key_id: "test-v1",
          }]
          : [],
      );
    }
    if (url.pathname.endsWith("/finish_upload_workflow")) {
      assert(body.p_owner === owner && body.p_workflow === workflow);
      live = false;
      return Response.json(true);
    }
    if (url.pathname.endsWith("/rotate_channel_library_credential")) {
      assert(
        body.p_owner === owner && body.p_workflow === workflow && body.p_previous_cipher === cipher,
      );
      assert(body.p_key_id === "test-v1");
      assert(
        await unseal(key, owner, `workflow:${workflow}:refresh:test-v1`, String(body.p_cipher)) ===
          "sensitive-rotated-refresh",
      );
      return Response.json(true);
    }
    assert(init?.redirect === "error");
    if (url.hostname === "oauth2.googleapis.com") {
      assert(new URLSearchParams(String(init?.body)).get("refresh_token") === "sensitive-refresh");
      return options.refreshFails
        ? Response.json({ error: "invalid_grant", sensitive: "provider-payload" }, { status: 400 })
        : Response.json({
          access_token: "sensitive-access-token",
          ...(options.rotate ? { refresh_token: "sensitive-rotated-refresh" } : {}),
        });
    }
    assert(new Headers(init?.headers).get("Authorization") === "Bearer sensitive-access-token");
    if (url.pathname.endsWith("/channels")) {
      return Response.json({
        items: [{
          id: options.wrongChannel ? "another-channel" : "synthetic-channel",
          contentDetails: { relatedPlaylists: { uploads: "synthetic-uploads" } },
        }],
      });
    }
    if (url.pathname.endsWith("/playlistItems")) {
      assert(url.searchParams.get("playlistId") === "synthetic-uploads");
      if (options.cleanupDuringRead) live = false;
      return Response.json({
        items: [{ contentDetails: { videoId: "synthetic01" } }],
        nextPageToken: "synthetic-next",
      });
    }
    if (url.pathname.endsWith("/videos")) return Response.json({ items: [video("synthetic01")] });
    throw new Error("Unexpected fixture request");
  };
  const handler = channelLibraryHandler((name) => config[name], send);
  const request = (body: unknown, token = "user", origin = config.FRONTEND_ORIGIN) =>
    new Request("https://project.supabase.co/functions/v1/channel-library", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Origin: origin,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  return { calls, handler, request, cipher };
}

Deno.test("discovery traverses the owned uploads playlist and filters actual video status, including sparse pages", async () => {
  const calls: URL[] = [];
  const rows = [
    video("synthetic01"),
    video("synthetic02", "private"),
    video("synthetic03", "public"),
    video("synthetic04", "unlisted", false),
    video("synthetic05", "unlisted", true, "other-channel"),
    { ...video("synthetic06"), status: { privacyStatus: "unlisted", uploadStatus: "failed" } },
  ];
  const library = new ChannelLibrary("access", "synthetic-channel", async (input, init) => {
    const url = new URL(String(input));
    calls.push(url);
    assert(new Headers(init?.headers).get("Authorization") === "Bearer access");
    if (url.pathname.endsWith("/channels")) {
      return Response.json({
        items: [{
          id: "synthetic-channel",
          contentDetails: { relatedPlaylists: { uploads: "owned-uploads" } },
        }],
      });
    }
    if (url.pathname.endsWith("/playlistItems")) {
      assert(url.searchParams.get("playlistId") === "owned-uploads");
      assert(url.searchParams.get("pageToken") === "cursor");
      return Response.json({
        items: rows.map((row) => ({ contentDetails: { videoId: row.id } })),
        nextPageToken: "next",
      });
    }
    // Deliberately reverse API response order; the playlist order must be preserved.
    return Response.json({ items: [...rows].reverse() });
  });
  const page = await library.page("cursor");
  assert(calls.length === 3 && page.items.length === 2 && page.nextPageToken === "next");
  assert(page.items[0].id === "synthetic01" && page.items[0].processed);
  assert(page.items[1].id === "synthetic04" && !page.items[1].processed);
  assert(
    !JSON.stringify(page).includes("private") && !JSON.stringify(page).includes("other-channel"),
  );
});

Deno.test("library authenticates before credentials, derives owner from identity, and never returns secrets", async () => {
  const f = await fixture();
  const response = await f.handler(
    f.request({ action: "list", owner_id: "forged-owner", channelId: "forged-channel" }),
  );
  const body = await response.text();
  assert(response.status === 200 && JSON.parse(body).items.length === 1);
  assert(response.headers.get("Cache-Control") === "no-store");
  assert(!body.includes("sensitive") && !body.includes(f.cipher));
  assert(f.calls[0].url.pathname === "/auth/v1/user");
});

Deno.test("rotated refresh tokens are encrypted and conditionally stored before channel discovery", async () => {
  const f = await fixture({ rotate: true });
  const response = await f.handler(f.request({ action: "list" }));
  assert(response.status === 200 && !(await response.text()).includes("sensitive"));
  const rotated = f.calls.findIndex((call) =>
    call.url.pathname.endsWith("/rotate_channel_library_credential")
  );
  const channel = f.calls.findIndex((call) => call.url.pathname.endsWith("/channels"));
  assert(rotated > 0 && rotated < channel);
});

Deno.test("empty filtered pages retain their continuation cursor without fabricating results", async () => {
  const library = new ChannelLibrary("access", "synthetic-channel", async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/channels")) {
      return Response.json({
        items: [{
          id: "synthetic-channel",
          contentDetails: { relatedPlaylists: { uploads: "owned-uploads" } },
        }],
      });
    }
    if (url.pathname.endsWith("/playlistItems")) {
      return Response.json({
        items: [{ contentDetails: { videoId: "synthetic01" } }],
        nextPageToken: "later-page",
      });
    }
    return Response.json({ items: [video("synthetic01", "private")] });
  });
  const page = await library.page();
  assert(page.items.length === 0 && page.nextPageToken === "later-page");
});

Deno.test("anonymous, invalid, signed-out and deleting accounts cannot reach provider credentials", async () => {
  for (const options of [{ authFails: true }, { inactive: true }, { deleting: true }]) {
    const f = await fixture(options);
    const response = await f.handler(f.request({ action: "list" }));
    assert([401, 403].includes(response.status));
    assert(!f.calls.some((call) => call.url.pathname.endsWith("/channel_library_context")));
  }
  const f = await fixture();
  assert(
    (await f.handler(f.request({ action: "list" }, "user", "https://evil.test"))).status === 403,
  );
  assert((await f.handler(new Request("https://example.test", { method: "POST" }))).status === 401);
  assert(f.calls.length === 0);
});

Deno.test("disconnected/expired workflows and wrong channels never return personal metadata", async () => {
  for (const options of [{ missing: true }, { expired: true }]) {
    const f = await fixture(options);
    const response = await f.handler(f.request({ action: "list" }));
    assert(response.status === 200 && !(await response.json()).connected);
    assert(!f.calls.some((call) => call.url.hostname.endsWith("googleapis.com")));
  }
  const f = await fixture({ wrongChannel: true });
  assert((await f.handler(f.request({ action: "list" }))).status === 409);
  assert(!f.calls.some((call) => call.url.pathname.endsWith("/playlistItems")));
});

Deno.test("cleanup during discovery prevents further provider requests and discards the result", async () => {
  const f = await fixture({ cleanupDuringRead: true });
  const response = await f.handler(f.request({ action: "list" }));
  assert(response.status === 409 && !(await response.text()).includes("Synthetic existing video"));
  assert(!f.calls.some((call) => call.url.pathname.endsWith("/videos")));
});

Deno.test("fresh selection verification cannot stand in for anonymous playback evidence", async () => {
  const f = await fixture();
  const response = await f.handler(
    f.request({ action: "verify", workflowId: workflow, videoIds: ["synthetic01"] }),
  );
  const body = await response.json();
  assert(response.status === 200 && body.requiresAnonymousPlaybackCheck === true);
  assert(!JSON.stringify(body).includes("watch?v=") && !JSON.stringify(body).includes("sensitive"));
  const invalid = await f.handler(
    f.request({ action: "verify", workflowId: workflow, videoIds: ["synthetic02"] }),
  );
  assert(invalid.status === 409);
});

Deno.test("library bounds request sizes and rejects forged IDs/cursors before provider calls", async () => {
  for (
    const input of [
      { action: "list", pageToken: "cursor" },
      { action: "list", workflowId: "not-a-uuid" },
      { action: "list", pageToken: "x".repeat(513), workflowId: workflow },
      { action: "verify", videoIds: ["synthetic01"] },
      { action: "verify", workflowId: workflow, videoIds: ["synthetic01", "synthetic01"] },
      { action: "verify", workflowId: workflow, videoIds: ["https://evil.test"] },
      { action: "verify", workflowId: workflow, videoIds: [] },
    ]
  ) {
    const f = await fixture();
    assert((await f.handler(f.request(input))).status === 400);
    assert(!f.calls.some((call) => call.url.pathname.endsWith("/channel_library_context")));
  }
  const f = await fixture({ refreshFails: true });
  const response = await f.handler(f.request({ action: "list" }));
  assert(response.status === 409 && !(await response.text()).includes("provider-payload"));
  assert(f.calls.some((call) => call.url.pathname.endsWith("/finish_upload_workflow")));
});
