import { expect, type Page, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { admin, createAccount } from "./local";
import type { Database } from "../frontend/database.types";
import type { QrChoice } from "../frontend/video-selection";

// Synthetic app/provider metadata only. These fixtures never upload or verify a real video.
const owners: string[] = [];
async function fixture(title = "Synthetic album") {
  const user = await createAccount();
  owners.push(user.id);
  const profile = await admin.from("profiles").insert({ owner_id: user.id });
  expect(profile.error).toBeNull();
  const album = await admin.from("albums").insert({ owner_id: user.id, title }).select().single();
  expect(album.error).toBeNull();
  const workflow = await admin.from("upload_workflows")
    .insert({ owner_id: user.id, album_id: album.data!.id }).select().single();
  expect(workflow.error).toBeNull();
  return { user, album: album.data!, workflow: workflow.data! };
}

async function entry(
  data: Awaited<ReturnType<typeof fixture>>,
  caption: string,
  patch: Partial<Database["public"]["Tables"]["upload_jobs"]["Insert"]> | null,
  order = 0,
) {
  const video = await admin.from("videos").insert({
    owner_id: data.user.id,
    album_id: data.album.id,
    caption,
    sort_order: order,
  }).select().single();
  expect(video.error).toBeNull();
  if (!patch) return { video: video.data!, choice: null };
  const now = new Date().toISOString();
  const job = await admin.from("upload_jobs").insert({
    owner_id: data.user.id,
    album_id: data.album.id,
    video_id: video.data!.id,
    workflow_id: data.workflow.id,
    idempotency_key: randomUUID(),
    upload_title: "Synthetic fixture — no real upload",
    state: "uploaded",
    provider_video_id: "synthetic01",
    requested_visibility: "unlisted",
    effective_visibility: "unlisted",
    processing_status: "succeeded",
    verified_at: now,
    channel_verified: true,
    anonymous_playback_verified_at: now,
    verified_size_bytes: 1024,
    verified_duration_seconds: 1,
    ...patch,
  }).select().single();
  expect(job.error).toBeNull();
  return {
    video: video.data!,
    choice: { videoId: video.data!.id, jobId: job.data!.id, workflowId: data.workflow.id },
  };
}

async function signIn(page: Page, user: Awaited<ReturnType<typeof createAccount>>) {
  await page.goto("/");
  await page.evaluate((session) => {
    localStorage.setItem("videoalbum.auth", JSON.stringify(session));
  }, user.session);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Your videos" })).toBeVisible();
}

async function resolve(page: Page, owner: string, choices: QrChoice[]) {
  return await page.evaluate(async ({ owner, choices }) => {
    // Exercise the same typed repository exported to the future QR download screen.
    const clientPath = "/frontend/client.ts", libraryPath = "/frontend/video-library.ts";
    const { client } = await import(clientPath);
    const { resolveQrSelection } = await import(libraryPath);
    try {
      return await resolveQrSelection(client, owner, choices, new AbortController().signal);
    } catch {
      return null;
    }
  }, { owner, choices });
}

test.afterEach(async () => {
  for (const owner of owners.splice(0)) {
    const removed = await admin.auth.admin.deleteUser(owner);
    expect(removed.error).toBeNull();
  }
});

test("minimal list selects only trusted eligible uploads; order is deterministic", async ({ page }) => {
  const data = await fixture();
  const unlisted = await entry(data, "Synthetic ready Unlisted", {}, -1);
  const publicVideo = await entry(data, "Synthetic ready Public", {
    requested_visibility: "public",
    effective_visibility: "public",
    public_confirmed_at: new Date().toISOString(),
  }, 1);
  for (
    const [caption, patch] of [
      ["Synthetic placeholder — no upload", null],
      ["Synthetic Private", { requested_visibility: "private", effective_visibility: "private" }],
      ["Synthetic pending", {
        state: "queued",
        processing_status: "pending",
        verified_at: null,
        anonymous_playback_verified_at: null,
      }],
      ["Synthetic processing", { processing_status: "processing" }],
      ["Synthetic unverified", { verified_at: null, anonymous_playback_verified_at: null }],
      ["Synthetic failed", { state: "failed", processing_status: "failed" }],
      ["Synthetic wrong channel", { channel_verified: false }],
      ["Synthetic no playback evidence", { anonymous_playback_verified_at: null }],
      ["Synthetic oversized", { verified_size_bytes: 1073741825 }],
      ["Synthetic too long", { verified_duration_seconds: 601 }],
    ] as const
  ) {
    await entry(data, caption, patch);
  }
  let providerRequests = 0;
  page.on("request", (request) => {
    if (request.url().includes("/functions/v1/youtube")) providerRequests++;
  });
  await signIn(page, data.user);
  const checkboxes = page.getByRole("region", { name: "Your videos" }).getByRole("checkbox");
  await expect(checkboxes).toHaveCount(12);
  await expect(page.getByRole("button", { name: "Upload videos" })).toBeDisabled();
  await expect(page.getByRole("heading", { name: "Compatibility tools" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /album|caption|rename|reorder/i })).toHaveCount(0);
  await expect(checkboxes.first()).toHaveAccessibleName(
    "Select Synthetic ready Unlisted for QR code",
  );
  await expect(checkboxes.last()).toHaveAccessibleName("Select Synthetic ready Public for QR code");
  for (let i = 1; i < 11; i++) await expect(checkboxes.nth(i)).toBeDisabled();
  await checkboxes.first().check();
  await checkboxes.last().check();
  await expect(page.getByText("2 videos selected for QR codes.")).toBeVisible();
  expect(providerRequests).toBe(0);
  expect(await resolve(page, data.user.id, [unlisted.choice!, publicVideo.choice!])).toEqual([
    { ...unlisted.choice, destination: "https://www.youtube.com/watch?v=synthetic01" },
    { ...publicVideo.choice, destination: "https://www.youtube.com/watch?v=synthetic01" },
  ]);
  expect(
    await resolve(page, data.user.id, [{ ...unlisted.choice!, videoId: publicVideo.video.id }]),
  )
    .toBeNull();
});

test("cleanup removes selection and provider status but preserves captions; cached choices fail", async ({ page }) => {
  const data = await fixture();
  const ready = await entry(data, "Synthetic lasting caption", {});
  await signIn(page, data.user);
  await page.getByRole("checkbox", { name: "Select Synthetic lasting caption for QR code" })
    .check();
  expect((await resolve(page, data.user.id, [ready.choice!]))?.length).toBe(1);
  const finished = await admin.rpc("finish_upload_workflow", {
    p_owner: data.user.id,
    p_workflow: data.workflow.id,
  });
  expect(finished.error).toBeNull();
  expect(await resolve(page, data.user.id, [ready.choice!])).toBeNull();
  await page.getByRole("button", { name: "Refresh videos" }).click();
  await expect(page.getByText("No active upload — QR unavailable", { exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Select Synthetic lasting caption for QR code" }))
    .toBeDisabled();
  await expect(page.getByText("0 videos selected for QR codes.")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Ready for QR — Unlisted");
  await expect(page.locator("body")).not.toContainText("synthetic01");
});

test("newer unverified upload never selects an older ready upload for the same entry", async ({ page }) => {
  const data = await fixture();
  const ready = await entry(data, "Synthetic replaced upload", {}, 0);
  const pending = await admin.from("upload_jobs").insert({
    owner_id: data.user.id,
    album_id: data.album.id,
    workflow_id: data.workflow.id,
    video_id: ready.video.id,
    idempotency_key: randomUUID(),
    upload_title: "Synthetic pending replacement",
    created_at: new Date(Date.now() + 1000).toISOString(),
  });
  expect(pending.error).toBeNull();
  await signIn(page, data.user);
  await expect(page.getByRole("checkbox", { name: "Select Synthetic replaced upload for QR code" }))
    .toBeDisabled();
  expect(await resolve(page, data.user.id, [ready.choice!])).toBeNull();
});

test("owner isolation and signing out clear video data and QR selection", async ({ browser }) => {
  const a = await fixture("Synthetic album A"), b = await fixture("Synthetic album B");
  const ready = await entry(a, "Synthetic video A", {});
  await entry(b, "Synthetic video B", {});
  const ca = await browser.newContext(), cb = await browser.newContext();
  try {
    const pa = await ca.newPage(), pb = await cb.newPage();
    await signIn(pa, a.user);
    await signIn(pb, b.user);
    await pa.getByRole("checkbox", { name: "Select Synthetic video A for QR code" }).check();
    await expect(pa.locator("body")).not.toContainText("Synthetic video B");
    await expect(pb.locator("body")).not.toContainText("Synthetic video A");
    expect(await resolve(pb, a.user.id, [ready.choice!])).toBeNull();
    expect(await resolve(pb, b.user.id, [ready.choice!])).toBeNull();
    await pa.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(pa.getByRole("button", { name: "Sign in with Google" })).toBeVisible();
    await expect(pa.locator("body")).not.toContainText("Synthetic video A");
    await expect(pb.getByRole("checkbox", { name: "Select Synthetic video B for QR code" }))
      .toBeEnabled();
  } finally {
    await ca.close();
    await cb.close();
  }
});

test("loading, empty and retry states do not offer stale selection", async ({ page }) => {
  const data = await fixture();
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => release = resolve);
  await page.route("**/rest/v1/videos?**", async (route) => {
    await blocked;
    await route.continue();
  });
  await signIn(page, data.user);
  await expect(page.getByText("Loading videos…")).toBeVisible();
  release();
  await expect(page.getByText("No videos yet. Uploaded videos will appear here.")).toBeVisible();
  await page.unroute("**/rest/v1/videos?**");
  await entry(data, "Synthetic ready before failure", {});
  await page.getByRole("button", { name: "Refresh videos" }).click();
  await page.getByRole("checkbox", { name: "Select Synthetic ready before failure for QR code" })
    .check();
  await page.route(
    "**/rest/v1/qr_ready_uploads?**",
    (route) =>
      route.fulfill({
        status: 403,
        contentType: "application/json",
        body: '{"message":"synthetic"}',
      }),
  );
  await page.getByRole("button", { name: "Refresh videos" }).click();
  await expect(page.getByRole("alert")).toHaveText("Could not load videos. Try again.");
  await expect(page.getByText("0 videos selected for QR codes.")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /Select Synthetic/ })).toHaveCount(0);
  await page.unroute("**/rest/v1/qr_ready_uploads?**");
  await page.getByRole("button", { name: "Refresh videos" }).click();
  await expect(
    page.getByRole("checkbox", { name: "Select Synthetic ready before failure for QR code" }),
  )
    .toBeEnabled();
});

test("idle expiry disables selection and hides provider status without reloading", async ({ page }) => {
  const data = await fixture();
  const ready = await entry(data, "Synthetic expiring upload", {});
  await page.clock.install();
  // Shorten only the browser's workflow response so its deadline can be exercised in isolation.
  // Database enforcement of actual seven-day expiry is covered by the transactional SQL suite.
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  await page.route("**/rest/v1/upload_workflows?**", async (route) => {
    const response = await route.fetch();
    const rows = await response.json();
    await route.fulfill({
      response,
      json: rows.map((row: object) => ({ ...row, expires_at: expiresAt })),
    });
  });
  await signIn(page, data.user);
  const checkbox = page.getByRole("checkbox", {
    name: "Select Synthetic expiring upload for QR code",
  });
  await checkbox.check();
  await expect(page.getByText("1 video selected for QR codes.")).toBeVisible();
  await page.clock.fastForward(60_001);
  await expect(checkbox).toBeDisabled();
  await expect(checkbox).not.toBeChecked();
  await expect(page.getByText("0 videos selected for QR codes.")).toBeVisible();
  await expect(page.getByText("No active upload — QR unavailable", { exact: true })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Ready for QR — Unlisted");
  expect(await resolve(page, data.user.id, [ready.choice!])).toBeNull();
});

test("existing Unlisted channel videos share the list, paginate and deduplicate current uploads", async ({ page }) => {
  const data = await fixture();
  await entry(data, "Synthetic app upload", {});
  const expiresAt = new Date(Date.now() + 3600000).toISOString();
  const requests: Record<string, unknown>[] = [];
  await page.route("**/functions/v1/channel-library", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const input = route.request().postDataJSON();
    requests.push(input);
    const items = input.pageToken
      ? [
        { id: "existing001", title: "Synthetic channel one", processed: true },
        { id: "existing002", title: "Synthetic channel two", processed: true },
      ]
      : [
        { id: "synthetic01", title: "Synthetic duplicate of app upload", processed: true },
        { id: "existing001", title: "Synthetic channel one", processed: true },
        { id: "pending0001", title: "Synthetic channel processing", processed: false },
      ];
    await route.fulfill({
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "http://127.0.0.1:5173" },
      body: JSON.stringify({
        connected: true,
        workflowId: data.workflow.id,
        expiresAt,
        items,
        nextPageToken: input.pageToken ? null : "synthetic-cursor",
        requiresAnonymousPlaybackCheck: true,
      }),
    });
  });
  await signIn(page, data.user);
  await expect(page.getByRole("checkbox", { name: "Select Synthetic channel one for QR code" }))
    .toBeEnabled();
  await expect(
    page.getByRole("checkbox", { name: "Select Synthetic channel processing for QR code" }),
  ).toBeDisabled();
  await expect(page.getByRole("checkbox", { name: /Synthetic duplicate/ })).toHaveCount(0);
  await page.getByRole("checkbox", { name: "Select Synthetic channel one for QR code" }).check();
  await page.getByRole("button", { name: "Load more YouTube videos" }).click();
  await expect(page.getByRole("checkbox", { name: "Select Synthetic channel two for QR code" }))
    .toBeEnabled();
  await expect(page.getByRole("checkbox", { name: "Select Synthetic channel one for QR code" }))
    .toHaveCount(1);
  await page.getByRole("checkbox", { name: "Select Synthetic channel two for QR code" }).check();
  await expect(page.getByText("2 videos selected for QR codes.")).toBeVisible();
  expect(requests[1]).toMatchObject({
    action: "list",
    workflowId: data.workflow.id,
    pageToken: "synthetic-cursor",
  });
  await expect(page.getByRole("button", { name: "Load more YouTube videos" })).toHaveCount(0);
  // The QR handoff must not convert a successful owner metadata read into anonymous playback proof.
  expect(
    await resolve(page, data.user.id, [{
      source: "channel",
      workflowId: data.workflow.id,
      videoId: "existing001",
    }]),
  ).toBeNull();
  expect(requests.at(-1)).toMatchObject({ action: "verify", videoIds: ["existing001"] });
  expect(await page.evaluate(() => localStorage.getItem("videoalbum.auth"))).not.toContain(
    "existing001",
  );
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sign in with Google" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Synthetic channel one");
});

test("existing channel metadata and selected IDs disappear on idle workflow expiry", async ({ page }) => {
  const data = await fixture();
  await page.clock.install();
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  await page.route("**/functions/v1/channel-library", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await route.fulfill({
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "http://127.0.0.1:5173" },
      body: JSON.stringify({
        connected: true,
        workflowId: data.workflow.id,
        expiresAt,
        items: [{ id: "existing001", title: "Synthetic temporary channel title", processed: true }],
        nextPageToken: "cursor",
      }),
    });
  });
  await signIn(page, data.user);
  await page.getByRole("checkbox", { name: "Select Synthetic temporary channel title for QR code" })
    .check();
  await expect(page.getByText("1 video selected for QR codes.")).toBeVisible();
  await page.clock.fastForward(60_001);
  await expect(page.locator("body")).not.toContainText("Synthetic temporary channel title");
  await expect(page.getByText("0 videos selected for QR codes.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Load more YouTube videos" })).toHaveCount(0);
});

test("channel page failure clears stale metadata and selection; refresh retries", async ({ page }) => {
  const data = await fixture();
  let fail = false;
  await page.route("**/functions/v1/channel-library", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await route.fulfill({
      status: fail ? 403 : 200,
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "http://127.0.0.1:5173" },
      body: JSON.stringify(
        fail ? { error: "channel_connection_expired" } : {
          connected: true,
          workflowId: data.workflow.id,
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
          items: [{ id: "existing001", title: "Synthetic channel retry", processed: true }],
          nextPageToken: "cursor",
        },
      ),
    });
  });
  await signIn(page, data.user);
  await page.getByRole("checkbox", { name: "Select Synthetic channel retry for QR code" }).check();
  fail = true;
  await page.getByRole("button", { name: "Load more YouTube videos" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Could not load existing YouTube videos. Refresh to try again.",
  );
  await expect(page.locator("body")).not.toContainText("Synthetic channel retry");
  await expect(page.getByText("0 videos selected for QR codes.")).toBeVisible();
  fail = false;
  await page.getByRole("button", { name: "Refresh videos" }).click();
  await expect(page.getByRole("checkbox", { name: "Select Synthetic channel retry for QR code" }))
    .toBeEnabled();
});
