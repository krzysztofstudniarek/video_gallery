import { type BrowserContext, expect, type Page, type Route, test } from "@playwright/test";
import { home, mockBackend, origin, owner, signedIn } from "./support";

const chunk = 8 * 1024 * 1024;
const file = {
  name: "synthetic-transfer.mp4",
  mimeType: "video/mp4",
  buffer: Buffer.alloc(chunk + 262144, 7),
};
const target = "https://www.googleapis.com/upload/youtube/v3/videos?upload_id=synthetic-session";
const cors = {
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Methods": "PUT, OPTIONS",
  "Access-Control-Allow-Headers": "content-range, content-type",
  "Access-Control-Expose-Headers": "Range",
};
function latch() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => resolve = done);
  return { promise, resolve };
}

// Real browser XHR, AbortController and reloads; only Auth/coordinator/provider responses are synthetic.
// The opaque byte fixture is used on an existing job: it is never passed off as a valid live MP4.
async function transferFixture(page: Page, context: BrowserContext) {
  const firstChunk = latch(), releaseChunk = latch();
  const actions: string[] = [], ranges: string[] = [], accepted: number[] = [];
  let offset = 0, dispatched = 0, resumed = 0, state = "queued", connected = true;
  let identity: { size: number; sha256: string } | undefined;
  async function fulfill(route: Route, json: unknown, status = 200) {
    await route.fulfill({ status, contentType: "application/json", headers: cors, json });
  }
  async function connection(route: Route) {
    if (route.request().postDataJSON().action === "workflow_disconnect") connected = false;
    return fulfill(route, {
      connected,
      workflowId: connected ? owner : null,
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      channel: connected ? { title: "Synthetic destination" } : null,
      disconnected: !connected,
      provider_revocation_pending: false,
    });
  }
  await signedIn(page);
  await context.route("https://www.googleapis.com/upload/youtube/v3/videos?**", async (route) => {
    if (route.request().method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: cors });
    }
    const range = route.request().headers()["content-range"];
    ranges.push(range);
    if (range.startsWith("bytes */")) {
      return route.fulfill({
        status: 308,
        headers: { ...cors, ...(offset ? { Range: `bytes=0-${offset - 1}` } : {}) },
      });
    }
    const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(range)!;
    expect(Number(match[1])).toBe(offset);
    expect(Number(match[3])).toBe(file.buffer.length);
    const bytes = route.request().postDataBuffer()!;
    expect(bytes.length).toBe(Number(match[2]) - offset + 1);
    expect(bytes.equals(file.buffer.subarray(offset, Number(match[2]) + 1))).toBe(true);
    offset = Number(match[2]) + 1;
    accepted.push(offset);
    if (accepted.length === 1) {
      firstChunk.resolve();
      // Simulate a committed first chunk whose response is lost when Pause aborts XHR.
      await releaseChunk.promise;
    }
    try {
      await route.fulfill(
        offset === file.buffer.length
          ? { status: 200, headers: cors, json: { id: "synthetic61" } }
          : { status: 308, headers: { ...cors, Range: `bytes=0-${offset - 1}` } },
      );
    } catch { /* Aborted browser requests intentionally have no response consumer. */ }
  });
  async function coordinator(route: Route) {
    const input = route.request().postDataJSON();
    actions.push(input.action);
    if (!connected) return fulfill(route, { error: "workflow_unavailable" }, 409);
    if (input.action === "dispatch" || input.action === "resume") {
      if (input.action === "dispatch") {
        if (state !== "queued") return fulfill(route, { error: "reconcile_existing_job" }, 409);
        dispatched++;
        state = "transferring";
        identity = { size: input.size, sha256: input.sha256 };
      } else {
        resumed++;
        expect({ size: input.size, sha256: input.sha256 }).toEqual(identity);
      }
      return fulfill(route, { sessionUrl: target });
    }
    if (input.action === "cancel") {
      state = "cancelled";
      return fulfill(route, { cancelled: true });
    }
    if (state === "cancelled") {
      return fulfill(route, { jobId: owner, state, requestedVisibility: "unlisted", pollCount: 0 });
    }
    if (input.action === "reconcile" && offset === file.buffer.length) state = "completed";
    return fulfill(route, {
      jobId: owner,
      workflowId: owner,
      state,
      requestedVisibility: "unlisted",
      effectiveVisibility: state === "completed" ? "unlisted" : null,
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      pollCount: state === "completed" ? 1 : 0,
      qrEligible: false,
      needsAnonymousPlayback: state === "completed",
    });
  }
  await page.route("**/functions/v1/youtube", connection);
  await page.route("**/functions/v1/uploads", coordinator);
  await page.goto(home + `uploads/${owner}`);
  await page.getByLabel("Reselect the original MP4 file").setInputFiles(file);
  await page.getByRole("button", { name: "Start upload", exact: true }).click();
  await firstChunk.promise;
  return {
    actions,
    ranges,
    accepted,
    release: releaseChunk.resolve,
    counts: () => ({ dispatched, resumed }),
    connection,
    coordinator,
  };
}

test("Pause recovers the existing job; reload requires the original file and resumes at accepted offset", async ({ page, context }) => {
  const transfer = await transferFixture(page, context);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  transfer.release();
  await expect(page.getByRole("button", { name: "Resume same upload" })).toBeEnabled();
  expect(transfer.counts()).toEqual({ dispatched: 1, resumed: 0 });
  page.on("dialog", (dialog) => dialog.accept());
  await page.reload();
  await expect(page.getByRole("button", { name: "Resume same upload" })).toBeDisabled();
  expect(transfer.ranges).toHaveLength(2);
  await page.getByLabel("Reselect the original MP4 file").setInputFiles(file);
  await page.getByRole("button", { name: "Resume same upload" }).click();
  await expect(page.getByText(/Upload status: completed/)).toBeVisible();
  expect(transfer.counts()).toEqual({ dispatched: 1, resumed: 1 });
  expect(transfer.ranges).toEqual([
    `bytes */${file.buffer.length}`,
    `bytes 0-${chunk - 1}/${file.buffer.length}`,
    `bytes */${file.buffer.length}`,
    `bytes ${chunk}-${file.buffer.length - 1}/${file.buffer.length}`,
  ]);
  expect(transfer.accepted).toEqual([chunk, file.buffer.length]);
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Home", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Stay here" })).toHaveCount(0);
});

test("cancelling an in-flight chunk aborts XHR and its bookmark cannot resume or dispatch", async ({ page, context }) => {
  const transfer = await transferFixture(page, context);
  await page.getByRole("button", { name: "Cancel this upload" }).click();
  await expect(page.getByText(/Upload cancelled locally. Any video already uploaded remains/))
    .toBeVisible();
  transfer.release();
  page.on("dialog", (dialog) => dialog.accept());
  await page.reload();
  await expect(page.getByText(/Upload status: cancelled/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Start upload|Resume same upload/ })).toHaveCount(
    0,
  );
  expect(transfer.counts()).toEqual({ dispatched: 1, resumed: 0 });
  expect(transfer.accepted).toEqual([chunk]);
  expect(transfer.actions).not.toContain("reconcile");
});

test("Account disconnect in another tab aborts the current XHR and never sends the next chunk", async ({ page, context }) => {
  const transfer = await transferFixture(page, context);
  const other = await context.newPage();
  await mockBackend(other);
  await other.route("**/functions/v1/youtube", transfer.connection);
  await other.goto(home + "account");
  await other.getByRole("button", { name: "Disconnect / retry Google revocation" }).click();
  await expect(page.getByText(/YouTube work stopped after disconnect/)).toBeVisible();
  transfer.release();
  await expect(page.getByRole("button", { name: /Start upload|Resume same upload/ })).toHaveCount(
    0,
  );
  expect(transfer.accepted).toEqual([chunk]);
  expect(transfer.counts()).toEqual({ dispatched: 1, resumed: 0 });
  await page.reload();
  await expect(page.getByText(/unavailable, expired or disconnected/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Start upload|Resume same upload/ })).toHaveCount(
    0,
  );
  await other.close();
});

for (const stop of ["route departure", "cross-tab disconnect"] as const) {
  test(`late Pause status cannot restore transfer controls after ${stop}`, async ({ page, context }) => {
    const transfer = await transferFixture(page, context);
    const statusSeen = latch(), releaseStatus = latch(), statusReturned = latch();
    await page.route("**/functions/v1/uploads", async (route) => {
      if (route.request().postDataJSON().action !== "status") return route.fallback();
      statusSeen.resolve();
      await releaseStatus.promise;
      try {
        await route.fulfill({
          contentType: "application/json",
          headers: cors,
          json: {
            jobId: owner,
            workflowId: owner,
            state: "transferring",
            requestedVisibility: "unlisted",
            expiresAt: new Date(Date.now() + 86400000).toISOString(),
            pollCount: 0,
          },
        });
      } catch { /* The request may already have been aborted by the stop action. */ }
      statusReturned.resolve();
    });
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    await statusSeen.promise;
    transfer.release();
    await expect(page.getByRole("button", { name: /Start upload|Resume same upload/ })).toHaveCount(
      0,
    );
    let other: Page | undefined;
    if (stop === "route departure") {
      await page.getByRole("link", { name: "Home", exact: true }).click();
      await page.getByRole("button", { name: "Leave screen", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Home", exact: true })).toBeVisible();
    } else {
      other = await context.newPage();
      await mockBackend(other);
      await other.route("**/functions/v1/youtube", transfer.connection);
      await other.goto(home + "account");
      await other.getByRole("button", { name: "Disconnect / retry Google revocation" }).click();
      await expect(page.getByText(/YouTube work stopped after disconnect/)).toBeVisible();
    }
    releaseStatus.resolve();
    await statusReturned.promise;
    await page.evaluate(() =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    );
    await expect(page.getByRole("button", { name: /Start upload|Resume same upload/ })).toHaveCount(
      0,
    );
    expect(transfer.counts()).toEqual({ dispatched: 1, resumed: 0 });
    expect(transfer.accepted).toEqual([chunk]);
    await other?.close();
  });
}
