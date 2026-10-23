import {
  authorizeUrl,
  base64,
  hash,
  randomSecret,
  seal,
  tokenRequest,
  unseal,
  uploadBody,
} from "../supabase/functions/_shared/youtube.ts";
import { youtubeHandler } from "../supabase/functions/_shared/youtube-handler.ts";
import { directUpload, type Transport } from "../frontend/direct-upload.ts";

function assert(value: unknown): asserts value {
  if (!value) throw new Error("Assertion failed");
}
async function rejects(call: () => Promise<unknown>) {
  let failed = false;
  try {
    await call();
  } catch {
    failed = true;
  }
  assert(failed);
}
const encodedKey = base64(new Uint8Array(32).fill(7));
Deno.test("encrypted envelopes persist and reject a different owner, purpose or key", async () => {
  const box = await seal(encodedKey, "owner-a", "refresh", "synthetic");
  assert(!box.includes("synthetic"));
  assert(await unseal(encodedKey, "owner-a", "refresh", box) === "synthetic");
  await rejects(() => unseal(encodedKey, "owner-b", "refresh", box));
  await rejects(() => unseal(encodedKey, "owner-a", "upload", box));
  await rejects(() => unseal(base64(new Uint8Array(32).fill(9)), "owner-a", "refresh", box));
});
Deno.test("consent uses independent state, PKCE and offline upload/read scopes", async () => {
  const state = randomSecret(), verifier = randomSecret();
  assert(state !== verifier && state.length === 43);
  const url = new URL(
    authorizeUrl(
      "synthetic-client",
      "https://example.test/?youtube_callback=1",
      state,
      await hash(verifier),
    ),
  );
  assert(url.searchParams.get("access_type") === "offline");
  assert(url.searchParams.get("code_challenge_method") === "S256");
  assert(url.searchParams.get("state") === state);
  assert(url.searchParams.get("scope")?.includes("youtube.upload"));
  assert(url.searchParams.get("scope")?.includes("youtube.readonly"));
  assert(!url.href.includes(verifier));
});
Deno.test("refresh uses server secret and never exposes a rejected token response", async () => {
  const send: typeof fetch = async (_url, options) => {
    const params = new URLSearchParams(String(options?.body));
    assert(params.get("grant_type") === "refresh_token");
    assert(params.get("client_secret") === "synthetic-secret");
    return Response.json(
      { error: "invalid_grant", error_description: "sensitive-provider-detail" },
      { status: 400 },
    );
  };
  try {
    await tokenRequest(send, "client", "synthetic-secret", {
      grant_type: "refresh_token",
      refresh_token: "synthetic",
    });
  } catch (error) {
    assert(error instanceof Error && error.message === "reconnect_youtube");
    return;
  }
  throw new Error("Expected rejected refresh");
});
Deno.test("upload metadata has no Public or Private fallback", () => {
  const body = uploadBody("synthetic-job", false);
  assert(body.status.privacyStatus === "unlisted");
  assert(body.status.selfDeclaredMadeForKids === false);
});
Deno.test("direct browser transport resumes at server offset with 256 KiB chunks", async () => {
  const file = new Blob([new Uint8Array(600000)]);
  const ranges: string[] = [];
  const send: Transport = async (_url, body, range) => {
    ranges.push(range);
    if (!body) return { status: 308, range: "bytes=0-262143", body: "" };
    if (ranges.length === 2) return { status: 308, range: "bytes=0-524287", body: "" };
    return { status: 200, range: null, body: JSON.stringify({ id: "synthetic01" }) };
  };
  const video = await directUpload(
    "https://www.googleapis.com/upload/youtube/v3/videos?synthetic=1",
    file,
    () => {},
    () => false,
    send,
  );
  assert(video === "synthetic01");
  assert(
    ranges.join("|") === "bytes */600000|bytes 262144-524287/600000|bytes 524288-599999/600000",
  );
});
Deno.test("missing exposed Range stops transfer and never starts a new session", async () => {
  let calls = 0;
  const send: Transport = async () => ({ status: 308, range: null, body: String(++calls) });
  await rejects(() =>
    directUpload(
      "https://www.googleapis.com/upload/youtube/v3/videos",
      new Blob([new Uint8Array(300000)]),
      () => {},
      () => false,
      send,
    )
  );
  assert(calls === 2);
});
Deno.test("pause prevents a chunk after status query; unexpected host sends no bytes", async () => {
  let calls = 0;
  const send: Transport = async () => {
    calls++;
    return { status: 308, range: null, body: "" };
  };
  const file = new Blob(["synthetic"]);
  assert(
    await directUpload(
      "https://www.googleapis.com/upload/youtube/v3/videos",
      file,
      () => {},
      () => true,
      send,
    ) === null,
  );
  assert(calls === 1);
  await rejects(() =>
    directUpload("https://example.test/upload", file, () => {}, () => false, send)
  );
  assert(calls === 1);
});

const owner = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
function syntheticBackend(overrides: Record<string, string | undefined> = {}) {
  const states = new Map<string, { owner: string; verifier: string }>();
  let credential: { refresh_cipher: string; channel_id: string; channel_title: string } | null =
    null;
  let exchanges = 0;
  let job: {
    job_id: string;
    session_cipher: string | null;
    size_bytes: number;
    file_sha256: string;
  } | null = null;
  let marker = "";
  let visibility = "unlisted";
  let initiations = 0;
  let rejectRevocation = false;
  const values: Record<string, string | undefined> = {
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_ANON_KEY: "synthetic-anon",
    SUPABASE_SERVICE_ROLE_KEY: "synthetic-admin",
    FRONTEND_ORIGIN: "https://example.test",
    YOUTUBE_CLIENT_ID: "synthetic-client",
    YOUTUBE_CLIENT_SECRET: "synthetic-secret",
    YOUTUBE_TOKEN_KEY_B64: encodedKey,
    YOUTUBE_REDIRECT_URI: "https://example.test/?youtube_callback=1",
    ...overrides,
  };
  const send: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/auth/v1/user") {
      return Response.json({
        id: new Headers(init?.headers).get("Authorization") === "Bearer other" ? other : owner,
      });
    }
    if (url.pathname.startsWith("/rest/v1/rpc/")) {
      const body = JSON.parse(String(init?.body));
      const name = url.pathname.split("/").pop();
      if (name === "current_app_session") {
        return Response.json({ active: true, deletion_requested: false });
      }
      if (name === "yt_probe_credentials") {
        return Response.json(body.p_owner === owner && credential ? [credential] : []);
      }
      if (name === "yt_probe_start") {
        states.set(body.p_hash, { owner: body.p_owner, verifier: body.p_verifier });
        return Response.json(null);
      }
      if (name === "yt_probe_consume") {
        const state = states.get(body.p_hash);
        if (!state || state.owner !== body.p_owner) return Response.json([]);
        states.delete(body.p_hash);
        return Response.json([{ verifier: state.verifier }]);
      }
      if (name === "yt_probe_save") {
        assert(body.p_owner === owner);
        assert(!body.p_cipher.includes("synthetic-refresh"));
        credential = {
          refresh_cipher: body.p_cipher,
          channel_id: body.p_channel,
          channel_title: body.p_title,
        };
        return Response.json(null);
      }
      if (name === "yt_probe_job") return Response.json(body.p_owner === owner && job ? [job] : []);
      if (name === "yt_probe_forget") {
        assert(body.p_owner === owner);
        credential = null;
        job = null;
        states.clear();
        return Response.json(null);
      }
      if (name === "yt_probe_reserve") {
        assert(body.p_owner === owner && !job);
        job = {
          job_id: body.p_job,
          session_cipher: null,
          size_bytes: body.p_size,
          file_sha256: body.p_hash,
        };
        return Response.json(null);
      }
      if (name === "yt_probe_session") {
        assert(body.p_owner === owner && job && body.p_job === job.job_id);
        job.session_cipher = body.p_cipher;
        assert(!body.p_cipher.includes("upload_id"));
        return Response.json(null);
      }
      throw new Error("Unexpected synthetic RPC");
    }
    if (url.href === "https://oauth2.googleapis.com/token") {
      const form = new URLSearchParams(String(init?.body));
      assert(form.get("client_secret") === "synthetic-secret");
      exchanges++;
      return Response.json({
        access_token: "synthetic-access",
        refresh_token: "synthetic-refresh",
        scope:
          "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly",
      });
    }
    if (url.pathname === "/youtube/v3/channels") {
      return Response.json({
        items: [{ id: "UC" + "x".repeat(22), snippet: { title: "Synthetic channel" } }],
      });
    }
    if (url.href === "https://oauth2.googleapis.com/revoke") {
      assert(new URLSearchParams(String(init?.body)).get("token") === "synthetic-refresh");
      return new Response(null, { status: rejectRevocation ? 503 : 200 });
    }
    if (url.pathname === "/upload/youtube/v3/videos") {
      if (init?.method === "OPTIONS") return new Response(null, { status: 204 });
      if (init?.method === "PUT") {
        assert(!init.body);
        return Response.json({ id: "synthetic01" });
      }
      initiations++;
      const metadata = JSON.parse(String(init?.body));
      assert(metadata.status.privacyStatus === "unlisted");
      marker = metadata.snippet.description;
      return new Response(null, {
        headers: {
          Location: "https://www.googleapis.com/upload/youtube/v3/videos?upload_id=synthetic",
        },
      });
    }
    if (url.pathname === "/youtube/v3/videos") {
      return Response.json({
        items: [{
          snippet: { channelId: "UC" + "x".repeat(22), description: marker },
          status: { privacyStatus: visibility, uploadStatus: "processed" },
          processingDetails: { processingStatus: "succeeded" },
        }],
      });
    }
    throw new Error("Unexpected synthetic network request");
  };
  const handler = youtubeHandler((name) => values[name], send);
  const call = (body: unknown, token = "owner") =>
    handler(
      new Request("https://project.supabase.co/functions/v1/youtube", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, Origin: "https://example.test" },
        body: JSON.stringify(body),
      }),
    );
  return {
    call,
    handler,
    exchanges: () => exchanges,
    initiations: () => initiations,
    rejectRevocation: (value: boolean) => {
      rejectRevocation = value;
    },
    privateVideo: () => {
      visibility = "private";
    },
  };
}
Deno.test("consent is owner-bound and one-use; tokens remain server-side and encrypted", async () => {
  const backend = syntheticBackend();
  const started = await backend.call({ action: "start", owner_id: other });
  assert(started.ok);
  const consent = new URL((await started.json()).authorization_url);
  const state = consent.searchParams.get("state");
  assert(
    (await backend.call({ action: "complete", code: "synthetic-code", state }, "other")).status ===
      400,
  );
  assert(backend.exchanges() === 0);
  const completed = await backend.call({ action: "complete", code: "synthetic-code", state });
  assert(completed.ok && !(await completed.text()).includes("synthetic-refresh"));
  assert(
    (await backend.call({ action: "complete", code: "synthetic-code", state })).status === 400,
  );
  assert(backend.exchanges() === 1);
  assert((await backend.call({ action: "refresh" })).ok);
  const status = await backend.call({ action: "status" });
  assert(!(await status.text()).includes("refresh_cipher"));
});
Deno.test("unconfigured consent reports status but does not start a provider flow", async () => {
  const backend = syntheticBackend({ YOUTUBE_CLIENT_ID: undefined });
  const status = await backend.call({ action: "status" });
  assert(status.ok && (await status.json()).configured === false);
  assert((await backend.call({ action: "start" })).status === 503);
  assert(backend.exchanges() === 0);
});
Deno.test("disconnect retains credentials on revoke failure and removes them only after success", async () => {
  const backend = syntheticBackend();
  const state = new URL((await (await backend.call({ action: "start" })).json()).authorization_url)
    .searchParams.get("state");
  assert((await backend.call({ action: "complete", state, code: "synthetic" })).ok);
  backend.rejectRevocation(true);
  const failure = await backend.call({ action: "disconnect" });
  assert(failure.status === 502 && (await failure.json()).error === "revocation_failed");
  assert((await (await backend.call({ action: "status" })).json()).connected === true);
  backend.rejectRevocation(false);
  assert((await backend.call({ action: "disconnect" })).ok);
  assert((await (await backend.call({ action: "status" })).json()).connected === false);
});
Deno.test("anonymous and foreign-origin requests cannot start YouTube consent", async () => {
  const backend = syntheticBackend();
  assert(
    (await backend.handler(new Request("https://project.supabase.co", { method: "POST" })))
      .status === 401,
  );
  assert(
    (await backend.handler(
      new Request("https://project.supabase.co", {
        method: "POST",
        headers: { Origin: "https://foreign.test", Authorization: "Bearer owner" },
      }),
    )).status === 403,
  );
});
Deno.test("upload requires explicit Unlisted/channel confirmation, saves encrypted session and cannot initiate twice", async () => {
  const backend = syntheticBackend();
  const state = new URL((await (await backend.call({ action: "start" })).json()).authorization_url)
    .searchParams.get("state");
  assert((await backend.call({ action: "complete", state, code: "synthetic" })).ok);
  const input = {
    action: "initiate",
    channel_id: "UC" + "x".repeat(22),
    confirmed_unlisted: true,
    made_for_kids: false,
    size: 1,
    mime: "video/mp4",
    sha256: "a".repeat(64),
  };
  assert((await backend.call({ ...input, confirmed_unlisted: false })).status === 400);
  assert((await backend.call({ ...input, channel_id: "wrong" })).status === 400);
  assert((await backend.call(input, "other")).status === 409);
  assert(backend.initiations() === 0);
  const result = await backend.call(input);
  assert(result.ok && (await result.json()).session_url.includes("upload_id=synthetic"));
  assert((await backend.call(input)).status === 409);
  assert(backend.initiations() === 1);
  assert((await backend.call({ action: "inspect" }, "other")).status === 409);
  const inspected = await backend.call({ action: "inspect" });
  assert(inspected.ok && (await inspected.json()).complete === true);
  assert(backend.initiations() === 1);
  assert(
    (await backend.call({ action: "resume", size: 1, sha256: "b".repeat(64) })).status === 400,
  );
  assert((await backend.call({ action: "resume", size: 1, sha256: "a".repeat(64) })).ok);
  const verified = await backend.call({ action: "verify", video_id: "synthetic01" });
  assert(verified.ok && (await verified.json()).ready === true);
  backend.privateVideo();
  const blocked = await backend.call({ action: "verify", video_id: "synthetic01" });
  assert(blocked.status === 409 && (await blocked.json()).error === "visibility_not_unlisted");
});
