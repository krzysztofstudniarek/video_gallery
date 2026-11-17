import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import {
  UploadCoordinator,
  uploadsHandler,
} from "../supabase/functions/_shared/uploads-handler.ts";
import {
  uploadMetadata,
  uploadRequest,
  verifyProviderVideo,
} from "../supabase/functions/_shared/upload-policy.ts";
import { sessionStatus } from "../supabase/functions/_shared/upload-provider.ts";
import { base64, seal, unseal } from "../supabase/functions/_shared/youtube/crypto.ts";
import { directUpload } from "../frontend/routes/tools/direct-upload.ts";
const owner = "00000000-0000-4000-8000-000000000015", job = "10000000-0000-4000-8000-000000000015";
const workflow = "20000000-0000-4000-8000-000000000015",
  lease = "30000000-0000-4000-8000-000000000015";
const channel = "UC" + "s".repeat(22), key = base64(new Uint8Array(32).fill(15));
const session = "https://www.googleapis.com/upload/youtube/v3/videos?upload_id=synthetic";
function assert(value: unknown): asserts value {
  if (!value) throw new Error("Upload assertion failed");
}
async function rejects(fn: () => unknown, code: string) {
  try {
    await fn();
  } catch (error) {
    assert(error instanceof Error && error.message === code);
    return;
  }
  throw new Error("Expected failure");
}
const request = {
  workflowId: workflow,
  key: lease,
  title: "User authored title",
  description: "User authored description",
  caption: "Separate album caption",
  visibility: "unlisted",
  confirmPublic: false,
  size: 1024,
  sha256: "a".repeat(64),
  madeForKids: false,
};
const video = {
  id: "synthetic15",
  snippet: { channelId: channel },
  status: { privacyStatus: "unlisted", uploadStatus: "processed" },
  processingDetails: { processingStatus: "succeeded" },
  fileDetails: { fileSize: "1024" },
  contentDetails: { duration: "PT1S" },
};
Deno.test("production metadata preserves authored text, bounds UTF-8 description and requires per-upload Public consent", async () => {
  const input = uploadRequest(request);
  assert(input.caption !== input.description);
  for (
    const patch of [
      { confirmPublic: false, visibility: "public" },
      { title: "<invalid>" },
      { description: "é".repeat(2501) },
      { size: 1073741825 },
      { sha256: "bad" },
      { madeForKids: null },
    ]
  ) await rejects(() => uploadRequest({ ...request, ...patch }), "invalid_upload_request");
  const body = uploadMetadata({
    upload_title: request.title,
    upload_description: request.description,
    requested_visibility: "public",
    public_confirmed_at: "2026-11-06T12:00:00Z",
  }, false);
  assert(
    body.snippet.title === request.title && body.snippet.description === request.description &&
      body.status.privacyStatus === "public",
  );
  await rejects(
    () =>
      uploadMetadata({
        upload_title: "Title",
        upload_description: "",
        requested_visibility: "public",
        public_confirmed_at: null,
      }, false),
    "public_confirmation_required",
  );
});
Deno.test("trusted verification checks exact ID, channel, requested privacy, processing, size and duration without silently changing privacy", async () => {
  const good = verifyProviderVideo(video, video.id, channel, "unlisted");
  assert(
    good.processing === "succeeded" && !good.failure && good.sizeBytes === 1024 &&
      good.seconds === 1,
  );
  await rejects(
    () => verifyProviderVideo({ ...video, id: "synthetic16" }, video.id, channel, "unlisted"),
    "video_ownership_mismatch",
  );
  await rejects(
    () => verifyProviderVideo(video, video.id, "wrong-channel", "unlisted"),
    "video_ownership_mismatch",
  );
  assert(verifyProviderVideo(video, video.id, channel, "public").failure === "visibility_mismatch");
  assert(
    verifyProviderVideo(
      { ...video, fileDetails: { fileSize: "1073741825" } },
      video.id,
      channel,
      "unlisted",
    ).failure === "provider_media_limit",
  );
  assert(
    verifyProviderVideo(
      { ...video, contentDetails: { duration: "PT10M1S" } },
      video.id,
      channel,
      "unlisted",
    ).failure === "provider_media_limit",
  );
  const missing = verifyProviderVideo(
    { ...video, fileDetails: undefined, contentDetails: { duration: "invalid" } },
    video.id,
    channel,
    "unlisted",
  );
  assert(missing.sizeBytes === null && missing.seconds === null);
  assert(
    verifyProviderVideo(
      { ...video, processingDetails: { processingStatus: "processing" } },
      video.id,
      channel,
      "unlisted",
    ).processing === "processing",
  );
  const privateVideo = {
    ...video,
    status: { privacyStatus: "private", uploadStatus: "processed" },
  };
  assert(!verifyProviderVideo(privateVideo, video.id, channel, "private").failure);
});
Deno.test("reconciliation uses an empty status PUT and does not follow 308 or accept malformed offsets/IDs", async () => {
  let calls = 0;
  const send: typeof fetch = async (url, init) => {
    calls++;
    assert(
      url === session && init?.method === "PUT" && init.body === null && init.redirect === "manual",
    );
    return new Response(null, {
      status: 308,
      headers: { Range: "bytes=0-511", Location: "https://evil.test" },
    });
  };
  const status = await sessionStatus(send, session, 1024);
  assert(status.offset === 512 && !status.videoId && calls === 1);
  await rejects(
    () =>
      sessionStatus(
        async () => new Response(null, { status: 308, headers: { Range: "bytes=0-5000" } }),
        session,
        1024,
      ),
    "completion_uncertain",
  );
  await rejects(
    () => sessionStatus(async () => Response.json({ id: "bad" }), session, 1024),
    "completion_uncertain",
  );
  await rejects(
    () => sessionStatus(async () => new Response(null, { status: 404 }), session, 1024),
    "session_unavailable_no_restart",
  );
});
async function backend() {
  let live = true,
    failInitiation = false,
    expireOnInitiation = false,
    claimed = false,
    sessionSaved = false,
    pollAllowed = true,
    permit = true;
  let initiations = 0, providerReads = 0, claimedCount = 0;
  let providerRevoked = false, latest = true;
  let receipt: Record<string, unknown> | null = null;
  let playbackRequests = 0, deliveryFinished = false;
  const downloads = new Set<string>();
  const row = {
    limits: { max_bytes: 1073741824, max_seconds: 600 },
    job: {
      id: job,
      workflow_id: workflow,
      video_id: lease,
      verified_at: null as string | null,
      anonymous_playback_verified_at: null as string | null,
      state: "queued",
      requested_visibility: "unlisted",
      public_confirmed_at: null as string | null,
      upload_title: request.title,
      upload_description: request.description,
      provider_video_id: null as string | null,
      processing_status: "pending",
      effective_visibility: null as string | null,
      verified_size_bytes: null as number | null,
      verified_duration_seconds: null as number | null,
    },
    control: {
      declared_bytes: 1024,
      file_sha256: "a".repeat(64),
      made_for_kids: false,
      dispatched_at: null as string | null,
      ambiguous: false,
      failure_code: null as string | null,
      poll_count: 0,
    },
    session: null as { session_cipher: string; key_id: string } | null,
    connection: {
      workflow_id: workflow,
      channel_id: channel,
      refresh_cipher: await seal(
        key,
        owner,
        `workflow:${workflow}:refresh:current`,
        "synthetic-refresh",
      ),
      key_id: "current",
      expires_at: "2099-01-01T00:00:00Z",
    },
  };
  const env: Record<string, string> = {
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_ANON_KEY: "synthetic-anon",
    SUPABASE_SERVICE_ROLE_KEY: "synthetic-admin",
    FRONTEND_ORIGIN: "https://example.test",
    YOUTUBE_CLIENT_ID: "client",
    YOUTUBE_CLIENT_SECRET: "secret",
    YOUTUBE_TOKEN_ACTIVE_KEY_ID: "current",
    YOUTUBE_TOKEN_KEYS_JSON: JSON.stringify({ current: key }),
  };
  const provider = { ...video, status: { ...video.status } };
  const send: typeof fetch = async (input, init) => {
    const url = new URL(String(input)), name = url.pathname.split("/").pop();
    if (url.pathname === "/auth/v1/user") return Response.json({ id: owner });
    if (name === "current_app_session") {
      return Response.json({ active: true, deletion_requested: false });
    }
    if (url.pathname.includes("/rpc/")) {
      const args = JSON.parse(String(init?.body));
      assert(args.p_owner === owner);
      switch (name) {
        case "create_upload_job":
          assert(args.p_title === request.title && !args.p_owner.includes("forged"));
          return Response.json(job);
        case "current_upload_destination":
          return Response.json(latest ? `https://www.youtube.com/watch?v=${video.id}` : null);
        case "upload_job_context":
          return Response.json(live ? row : null);
        case "claim_upload_dispatch":
          if (claimed) return Response.json("reconcile_existing_job");
          claimed = true;
          claimedCount++;
          row.job.state = "initiating";
          row.control.ambiguous = true;
          return Response.json("claimed");
        case "save_upload_session":
          if (!live) return Response.json(false);
          assert(await unseal(key, owner, `upload:${job}:current`, args.p_cipher) === session);
          row.session = { session_cipher: args.p_cipher, key_id: args.p_key_id };
          row.control.ambiguous = false;
          row.job.state = "transferring";
          sessionSaved = true;
          return Response.json(true);
        case "upload_transfer_permit":
          return Response.json(live && permit);
        case "upload_poll_claim":
          row.control.poll_count++;
          return Response.json(pollAllowed);
        case "request_upload_playback":
          playbackRequests++;
          return Response.json(true);
        case "upload_delivery_context":
          return Response.json(live ? { workflowId: workflow, jobs: [] } : null);
        case "upload_delivery_receipt":
          return Response.json(deliveryFinished);
        case "acknowledge_upload_download":
          downloads.add(args.p_kind);
          return Response.json(live);
        case "complete_upload_delivery":
          if (downloads.size !== 3) return Response.json(false);
          live = false;
          deliveryFinished = true;
          return Response.json(true);
        case "record_upload_result":
          row.job.verified_at = new Date().toISOString();
          row.job.anonymous_playback_verified_at = null;
          row.job.provider_video_id = args.p_video;
          row.job.effective_visibility = args.p_visibility;
          row.job.processing_status = args.p_processing;
          row.job.verified_size_bytes = args.p_size;
          row.job.verified_duration_seconds = args.p_duration;
          row.job.state = args.p_failure ? "failed" : "uploaded";
          row.control.failure_code = args.p_failure;
          row.session = null;
          return Response.json(live);
        case "upload_job_receipt":
          return Response.json(receipt);
        case "cancel_upload_job":
          receipt = { jobId: job, workflowId: workflow, state: "cancelled" };
          live = false;
          row.session = null;
          return Response.json(true);
        case "finish_upload_workflow":
          live = false;
          return Response.json(true);
        default:
          throw new Error("Unexpected RPC");
      }
    }
    if (url.href === "https://oauth2.googleapis.com/token") {
      return Response.json({ access_token: "synthetic-access" });
    }
    if (url.pathname === "/upload/youtube/v3/videos" && init?.method === "POST") {
      initiations++;
      assert(claimed && new Headers(init.headers).get("Origin") === env.FRONTEND_ORIGIN);
      const metadata = JSON.parse(String(init.body));
      assert(
        metadata.snippet.description === request.description &&
          metadata.status.privacyStatus === row.job.requested_visibility,
      );
      if (expireOnInitiation) live = false;
      if (failInitiation) throw new Error("ambiguous provider timeout including SECRET");
      return new Response(null, { status: 200, headers: { Location: session } });
    }
    if (url.href === session && init?.method === "PUT") return Response.json({ id: video.id });
    if (url.pathname === "/youtube/v3/videos") {
      providerReads++;
      if (providerRevoked) {
        return Response.json({ error: { message: "private provider details" } }, { status: 401 });
      }
      return Response.json({ items: [provider] });
    }
    throw new Error("Unexpected request");
  };
  const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
    global: { fetch: send },
  });
  const coordinator = new UploadCoordinator(
    admin,
    owner,
    (name) => env[name],
    env.FRONTEND_ORIGIN,
    send,
  );
  const handler = uploadsHandler((name) => env[name], send);
  return {
    coordinator,
    row,
    provider,
    handler,
    expire: () => {
      live = false;
    },
    failInitiation: () => {
      failInitiation = true;
    },
    expireOnInitiation: () => {
      expireOnInitiation = true;
    },
    replaceJob: () => {
      latest = false;
    },
    revokeProvider: () => {
      providerRevoked = true;
    },
    denyPoll: () => {
      pollAllowed = false;
    },
    denyPermit: () => {
      permit = false;
    },
    counts: () => ({ initiations, providerReads, claimedCount, sessionSaved, playbackRequests }),
  };
}
const dispatch = { action: "dispatch", jobId: job, lease, size: 1024, sha256: "a".repeat(64) };
Deno.test("production dispatch reserves once, encrypts its capability, preserves metadata and reconciles the existing session", async () => {
  const b = await backend();
  const result = await b.coordinator.act(dispatch);
  assert("sessionUrl" in result && result.sessionUrl === session && b.counts().sessionSaved);
  await rejects(() => b.coordinator.act(dispatch), "reconcile_existing_job");
  assert(b.counts().initiations === 1 && b.counts().claimedCount === 1);
  const ready = await b.coordinator.act({ action: "reconcile", jobId: job, videoId: "forged-id" });
  assert(
    "state" in ready && ready.state === "completed" && !ready.qrEligible &&
      ready.needsAnonymousPlayback,
  );
  assert(b.row.job.provider_video_id === video.id && !b.row.session);
  const status = JSON.stringify(await b.coordinator.act({ action: "status", jobId: job }));
  assert(
    !status.includes("cipher") && !status.includes("sessionUrl") && !status.includes("synthetic15"),
  );
});
Deno.test("ambiguous initiation keeps its one-use claim and never starts a replacement session", async () => {
  const b = await backend();
  b.failInitiation();
  try {
    await b.coordinator.act(dispatch);
  } catch { /* The simulated network exception is intentionally ambiguous. */ }
  assert(b.counts().initiations === 1 && b.row.control.ambiguous);
  await rejects(() => b.coordinator.act(dispatch), "reconcile_existing_job");
  await rejects(
    () => b.coordinator.act({ action: "reconcile", jobId: job }),
    "initiation_uncertain_no_restart",
  );
  assert(b.counts().initiations === 1);
});
Deno.test("disconnect/cancellation prevents new requests and late initiation responses cannot return capabilities", async () => {
  const b = await backend();
  b.expireOnInitiation();
  await rejects(() => b.coordinator.act(dispatch), "initiation_uncertain_reconcile");
  assert(!b.counts().sessionSaved);
  const c = await backend();
  await c.coordinator.act(dispatch);
  await c.coordinator.act({ action: "cancel", jobId: job });
  await rejects(
    () =>
      c.coordinator.act({
        action: "resume",
        jobId: job,
        lease,
        size: 1024,
        sha256: "a".repeat(64),
      }),
    "workflow_unavailable",
  );
  assert(c.counts().providerReads === 0);
});
Deno.test("resume requires original-file evidence and live transfer permit; polling budget bounds provider traffic", async () => {
  const b = await backend();
  await b.coordinator.act(dispatch);
  await rejects(
    () => b.coordinator.act({ ...dispatch, action: "resume", sha256: "b".repeat(64) }),
    "choose_original_file",
  );
  b.denyPermit();
  await rejects(
    () => b.coordinator.act({ ...dispatch, action: "resume" }),
    "transfer_busy_or_expired",
  );
  b.denyPoll();
  await rejects(
    () => b.coordinator.act({ action: "reconcile", jobId: job }),
    "poll_budget_or_cooldown",
  );
  assert(b.counts().providerReads === 0);
});
Deno.test("privacy mismatch blocks readiness; a completed Private upload never becomes QR eligible", async () => {
  const b = await backend();
  await b.coordinator.act(dispatch);
  b.provider.status.privacyStatus = "private";
  const failed = await b.coordinator.act({ action: "reconcile", jobId: job });
  assert(
    "state" in failed && failed.state === "failed" && failed.failure === "visibility_mismatch" &&
      !failed.qrEligible,
  );
  const c = await backend();
  c.row.job.requested_visibility = "private";
  c.provider.status.privacyStatus = "private";
  await c.coordinator.act(dispatch);
  const completed = await c.coordinator.act({ action: "reconcile", jobId: job });
  assert(
    "state" in completed && completed.state === "completed" && !completed.qrEligible &&
      !completed.needsAnonymousPlayback,
  );
});
Deno.test("production endpoint authenticates, limits request size and never reflects provider failures", async () => {
  const b = await backend();
  const req = (body: unknown, origin = "https://example.test", auth = true) =>
    new Request("https://project.supabase.co/functions/v1/uploads", {
      method: "POST",
      headers: { Origin: origin, ...(auth ? { Authorization: "Bearer synthetic" } : {}) },
      body: JSON.stringify(body),
    });
  assert((await b.handler(req(dispatch, "https://evil.test"))).status === 403);
  assert((await b.handler(req(dispatch, undefined, false))).status === 401);
  assert(
    (await b.handler(req({ action: "create", ...request, description: "x".repeat(33000) })))
      .status === 413,
  );
  b.failInitiation();
  const failure = await b.handler(req(dispatch));
  const text = await failure.text();
  assert(failure.status === 502 && !text.includes("SECRET") && !text.includes("upload_id"));
});
Deno.test("production transfer supports aligned larger chunks and never sends media after permission abort", async () => {
  const file = new Blob([new Uint8Array(9 * 1024 * 1024)]);
  let requests = 0;
  const id = await directUpload(
    session,
    file,
    () => {},
    () => false,
    async (_url, body) => {
      requests++;
      if (!body) return { status: 308, range: null, body: "" };
      if (requests === 2) {
        assert(body.size === 8 * 1024 * 1024);
        return { status: 308, range: `bytes=0-${8 * 1024 * 1024 - 1}`, body: "" };
      }
      return { status: 200, range: null, body: JSON.stringify({ id: video.id }) };
    },
    undefined,
    8 * 1024 * 1024,
  );
  assert(id === video.id && requests === 3);
});

Deno.test("revocation during verification erases workflow capabilities before subsequent provider requests", async () => {
  const b = await backend();
  await b.coordinator.act(dispatch);
  b.revokeProvider();
  await rejects(() => b.coordinator.act({ action: "reconcile", jobId: job }), "reconnect_youtube");
  await rejects(
    () =>
      b.coordinator.act({
        action: "resume",
        jobId: job,
        lease,
        size: 1024,
        sha256: "a".repeat(64),
      }),
    "workflow_unavailable",
  );
  assert(b.counts().providerReads === 1);
});
Deno.test("cancelled bookmarks return provider-free receipts and cannot recreate the original request", async () => {
  const b = await backend();
  await b.coordinator.act({ action: "cancel", jobId: job });
  const receipt = await b.coordinator.act({ action: "status", jobId: job });
  assert("state" in receipt && receipt.state === "cancelled" && !receipt.qrEligible);
  assert(!JSON.stringify(receipt).includes("cipher") && b.counts().initiations === 0);
});

Deno.test("pre-print queues privileged playback and only fresh playback can resolve direct destinations", async () => {
  const b = await backend();
  await b.coordinator.act(dispatch);
  await b.coordinator.act({ action: "preprint", jobId: job });
  assert(b.counts().playbackRequests === 1);
  const choices = [{ jobId: job, workflowId: workflow, videoId: lease }];
  await rejects(
    () => b.coordinator.act({ action: "destinations", choices }),
    "verification_required",
  );
  b.row.job.anonymous_playback_verified_at = new Date().toISOString();
  const result = await b.coordinator.act({ action: "destinations", choices });
  assert(result.entries[0].destination === `https://www.youtube.com/watch?v=${video.id}`);
  await rejects(
    () =>
      b.coordinator.act({ action: "destinations", choices: [{ ...choices[0], videoId: owner }] }),
    "verification_required",
  );
  b.replaceJob();
  await rejects(
    () => b.coordinator.act({ action: "destinations", choices }),
    "verification_required",
  );
  b.row.job.verified_at = new Date(Date.now() - 360000).toISOString();
  await rejects(
    () => b.coordinator.act({ action: "destinations", choices }),
    "verification_required",
  );
});
Deno.test("workflow finish requires explicit saved-files confirmation and all download acknowledgements", async () => {
  const b = await backend(), body = { workflowId: workflow, batchId: lease };
  await rejects(() => b.coordinator.act({ ...body, action: "finish" }), "confirm_saved_downloads");
  await rejects(
    () => b.coordinator.act({ ...body, action: "finish", confirmSaved: true }),
    "downloads_required_or_changed",
  );
  await rejects(
    () => b.coordinator.act({ ...body, action: "downloaded", kind: "forged" }),
    "invalid_download_kind",
  );
  for (const kind of ["sheet", "individual", "links"]) {
    await b.coordinator.act({ ...body, action: "downloaded", kind, ownerId: "forged" });
  }
  const result = await b.coordinator.act({ ...body, action: "finish", confirmSaved: true });
  assert(result.completed);
  const bookmark = await b.coordinator.act({ action: "delivery", workflowId: workflow });
  assert(bookmark.completed);
  assert(!JSON.stringify(bookmark).includes("destination"));
});
