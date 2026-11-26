import { expect, type Page, test } from "@playwright/test";
import { checkAnonymousPlayback } from "../scripts/playback-worker.mjs";
import { home, mockBackend, origin, owner, signedIn } from "./support";

test("channel discovery discards a response that arrives after workflow expiry", async ({ page }) => {
  await page.clock.install();
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  let release!: () => void;
  let started!: () => void;
  const pending = new Promise<void>((resolve) => release = resolve);
  const seen = new Promise<void>((resolve) => started = resolve);
  await signedIn(page);
  await page.route("**/functions/v1/channel-library", async (route) => {
    started();
    await pending;
    await route.fulfill({
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": origin },
      json: {
        connected: true,
        workflowId: owner,
        expiresAt,
        items: [{ id: "existing001", title: "Synthetic late discovery", processed: true }],
        nextPageToken: "synthetic-expired-cursor",
      },
    });
  });
  await page.getByRole("link", { name: "Your videos", exact: true }).click();
  await seen;
  await page.clock.fastForward(60_001);
  release();
  await expect(page.getByRole("alert")).toHaveText(
    "Could not load existing YouTube videos. Refresh to try again.",
  );
  await expect(page.locator("body")).not.toContainText("Synthetic late discovery");
  await expect(page.getByRole("button", { name: "Load more YouTube videos" })).toHaveCount(0);
});

test("expiry cancels pending pagination and a late page cannot restore the cursor", async ({ page }) => {
  await page.clock.install();
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  await signedIn(page);
  let release!: () => void;
  let started!: () => void;
  const pending = new Promise<void>((resolve) => release = resolve);
  const seen = new Promise<void>((resolve) => started = resolve);
  await page.route("**/functions/v1/channel-library", async (route) => {
    const more = !!route.request().postDataJSON().pageToken;
    if (more) {
      started();
      await pending;
    }
    await route.fulfill({
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": origin },
      json: {
        connected: true,
        workflowId: owner,
        expiresAt,
        items: [{
          id: more ? "existing002" : "existing001",
          title: more ? "Synthetic late page" : "Synthetic expiring selection",
          processed: true,
        }],
        nextPageToken: "synthetic-expired-cursor",
      },
    });
  });
  await page.getByRole("link", { name: "Your videos", exact: true }).click();
  await page.getByRole("checkbox", { name: "Select Synthetic expiring selection for QR code" })
    .check();
  await page.getByRole("button", { name: "Load more YouTube videos" }).click();
  await seen;
  await page.clock.fastForward(60_001);
  await expect(page.getByText("0 videos selected for QR codes.")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Synthetic expiring selection");
  release();
  // Let the browser process the late response before checking it cannot repopulate navigation.
  await page.clock.runFor(100);
  await expect(page.getByRole("button", { name: /Load more YouTube videos|Loading more videos/ }))
    .toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("Synthetic late page");
});

test("home is the default; direct routes, reload, Back/Forward and title/focus work", async ({ page }) => {
  await signedIn(page);
  await expect(page.getByRole("heading", { name: "Home", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Your videos", exact: true }).click();
  await expect(page).toHaveURL(home + "videos");
  await expect(page).toHaveTitle("Your videos | VideoAlbum");
  await expect(page.getByRole("heading", { name: "VideoAlbum", exact: true })).toBeFocused();
  await page.getByRole("link", { name: "Account", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Delete account", exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Your videos", exact: true })).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(home + "account");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Delete account", exact: true })).toBeVisible();
  await page.goto(home + "videos");
  await expect(page.getByRole("heading", { name: "Your videos", exact: true })).toBeVisible();
});

test("signed-out bookmark returns through the exact root PKCE callback once", async ({ page }) => {
  await mockBackend(page);
  let exchanges = 0;
  page.on("request", (request) => {
    if (request.url().includes("grant_type=pkce")) exchanges++;
  });
  await page.route("**/auth/v1/authorize?**", (route) => {
    expect(new URL(route.request().url()).searchParams.get("redirect_to")).toBe(home);
    return route.fulfill({ contentType: "text/html", body: "Synthetic identity provider" });
  });
  await page.goto(home + "account");
  await page.getByRole("button", { name: "Sign in with Google" }).click();
  await expect(page.getByText("Synthetic identity provider")).toBeVisible();
  await page.goto(home + "?code=synthetic-once");
  await expect(page).toHaveURL(home + "account");
  await expect(page.getByRole("heading", { name: "Delete account", exact: true })).toBeVisible();
  expect(exchanges).toBe(1);
  expect(await page.evaluate(() => sessionStorage.getItem("videoalbum.return"))).toBeNull();
  await page.reload();
  expect(exchanges).toBe(1);
});

test("YouTube callback completes once and restores the guarded tools route", async ({ page }) => {
  await signedIn(page, "tools");
  const dialogs: string[] = [];
  page.on("dialog", async (dialog) => {
    dialogs.push(dialog.type());
    await dialog.dismiss();
  });
  await page.route(
    "https://accounts.google.com/**",
    (route) => route.fulfill({ contentType: "text/html", body: "Synthetic YouTube consent" }),
  );
  let completed = 0;
  page.on("request", (request) => {
    if (
      request.url().endsWith("/youtube") && request.method() === "POST" &&
      request.postDataJSON().action === "complete"
    ) completed++;
  });
  await page.getByRole("button", { name: "Connect YouTube", exact: true }).click();
  await expect(page.getByText("Synthetic YouTube consent")).toBeVisible();
  expect(dialogs).toEqual([]);
  await page.goto(
    home + "?youtube_callback=1&code=synthetic-youtube-code&state=synthetic-youtube-state",
  );
  await expect(page).toHaveURL(home + "tools");
  await expect(
    page.getByText("YouTube consent saved. Confirm the destination channel before uploading."),
  ).toBeVisible();
  await expect(page.locator("#youtube-status")).toContainText("Synthetic channel");
  expect(completed).toBe(1);
  const storage = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  expect(storage).not.toContain("synthetic-youtube-code");
  expect(storage).not.toContain("synthetic-youtube-state");
  await page.reload();
  expect(completed).toBe(1);
});

test("YouTube consent warns about selected inputs and leaves only after confirmation", async ({ page }) => {
  await signedIn(page, "tools");
  await page.route(
    "https://accounts.google.com/**",
    (route) => route.fulfill({ contentType: "text/html", body: "Synthetic YouTube consent" }),
  );
  await page.getByLabel("Is this test video made for kids?").selectOption("no");
  const dialogs: string[] = [];
  let allow = false;
  page.on("dialog", async (dialog) => {
    dialogs.push(dialog.type());
    if (dialog.type() === "confirm" && allow) await dialog.accept();
    else await dialog.dismiss();
  });
  await page.getByRole("button", { name: "Connect YouTube", exact: true }).click();
  await expect.poll(() => dialogs.length).toBe(1);
  expect(dialogs).toEqual(["confirm"]);
  await expect(page).toHaveURL(home + "tools");
  await expect(page.getByLabel("Is this test video made for kids?")).toHaveValue("no");
  expect(await page.evaluate(() => sessionStorage.getItem("videoalbum.return"))).toBeNull();
  // Cancelling consent must retain the normal unfinished-work guard.
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await expect(page.getByRole("button", { name: "Stay here" })).toBeVisible();
  await page.getByRole("button", { name: "Stay here" }).click();
  allow = true;
  await page.getByRole("button", { name: "Connect YouTube", exact: true }).click();
  await expect(page.getByText("Synthetic YouTube consent")).toBeVisible();
  expect(dialogs).toEqual(["confirm", "confirm"]);
});

test("malformed callbacks are scrubbed without exchange or reflecting provider errors", async ({ page }) => {
  await mockBackend(page);
  let exchanges = 0;
  page.on("request", (request) => {
    if (request.url().includes("grant_type=pkce")) exchanges++;
  });
  for (
    const suffix of [
      "?code=secret&code=duplicate",
      "?code=secret&error=denied",
      "?state=secret",
      "?error=denied&error_description=sensitive-provider-error",
      "#access_token=secret",
    ]
  ) {
    await page.goto(home + suffix);
    await expect(page).toHaveURL(home);
    await expect(page.getByText("Google sign-in did not complete. Please try again."))
      .toBeVisible();
    await expect(page.locator("body")).not.toContainText("sensitive-provider-error");
  }
  expect(exchanges).toBe(0);
});

test("external and expired return destinations are discarded; callbacks stay at root", async ({ page }) => {
  await mockBackend(page);
  await page.goto(home);
  for (
    const [path, created] of [
      ["https://example.test", Date.now()],
      ["//example.test", Date.now()],
      ["/account?code=secret", Date.now()],
      ["/account", 1],
    ] as const
  ) {
    await page.evaluate(({ path, created }) => {
      sessionStorage.setItem("videoalbum.return", JSON.stringify({ flow: "auth", path, created }));
      localStorage.setItem("videoalbum.auth-code-verifier", JSON.stringify("synthetic-verifier"));
    }, { path, created });
    await page.goto(home + "?code=synthetic");
    await expect(page.getByRole("heading", { name: "Home", exact: true })).toBeVisible();
    await expect(page).toHaveURL(home);
  }
});

test("unknown app routes show not-found; assets fail as assets and headers protect callbacks", async ({ page, request }) => {
  await mockBackend(page);
  await page.goto(home + "missing-screen");
  await expect(page.getByRole("heading", { name: "Page not found", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Go home" }).click();
  await expect(page).toHaveURL(home);
  for (const path of ["assets/missing.js", "missing.png"]) {
    const result = await request.get(home + path);
    expect(result.status()).toBe(404);
    expect(result.headers()["content-type"]).not.toContain("text/html");
  }
  const result = await request.get(home + "account");
  expect(result.status()).toBe(200);
  expect(result.headers()["referrer-policy"]).toBe("no-referrer");
  expect(result.headers()["x-content-type-options"]).toBe("nosniff");
  expect(result.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
});

test("leaving preserves safe choices and sign-out then Back cannot expose private content", async ({ page }) => {
  await signedIn(page, "videos");
  await page.route("**/functions/v1/channel-library", (route) =>
    route.fulfill({
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": origin },
      body: JSON.stringify({
        connected: true,
        workflowId: owner,
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        items: [{ id: "existing001", title: "Synthetic private selection", processed: true }],
        nextPageToken: null,
      }),
    }));
  await page.reload();
  await page.getByRole("checkbox", { name: "Select Synthetic private selection for QR code" })
    .check();
  await page.getByRole("link", { name: "Account", exact: true }).click();
  await expect(page).toHaveURL(home + "account");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sign in with Google" })).toBeVisible();
  await page.goBack();
  await expect(page.locator("body")).not.toContainText("Synthetic private selection");
  await expect(page.getByRole("heading", { name: "Your videos", exact: true })).toHaveCount(0);
});

test("Back and Forward restore eligible in-memory selection without persisting provider IDs", async ({ page }) => {
  await signedIn(page);
  await page.route("**/functions/v1/channel-library", (route) =>
    route.fulfill({
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": origin },
      body: JSON.stringify({
        connected: true,
        workflowId: owner,
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        items: [{ id: "existing001", title: "Synthetic Back selection", processed: true }],
        nextPageToken: null,
      }),
    }));
  await page.getByRole("link", { name: "Your videos", exact: true }).click();
  await page.getByRole("checkbox", { name: "Select Synthetic Back selection for QR code" }).check();
  await page.goBack();
  await expect(page).toHaveURL(home);
  await page.goForward();
  await expect(page.getByText("1 video selected for QR codes.")).toBeVisible();
  const selection = page.getByRole("checkbox", {
    name: "Select Synthetic Back selection for QR code",
  });
  await expect(selection).toBeChecked();
  const navigationState = await page.evaluate(() =>
    JSON.stringify({
      url: location.href,
      history: history.state,
      local: { ...localStorage },
      tab: { ...sessionStorage },
    })
  );
  expect(navigationState).not.toContain("existing001");
  expect(navigationState).not.toContain("Synthetic Back selection");
  await page.getByRole("button", { name: "Refresh videos" }).click();
  await expect(selection).not.toBeChecked();
  await selection.check();
  page.on("dialog", (dialog) => dialog.accept());
  await page.reload();
  await expect(page).toHaveURL(home + "videos");
  await expect(selection).not.toBeChecked();
  await expect(page.getByText("0 videos selected for QR codes.")).toBeVisible();
});

test("a delayed consent callback cannot restore a session signed out in another tab", async ({ page, context }) => {
  await signedIn(page);
  const other = await context.newPage();
  await mockBackend(other);
  await other.goto(home);
  await expect(other.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
  let complete!: () => void;
  let started!: () => void;
  const pending = new Promise<void>((resolve) => complete = resolve);
  const seen = new Promise<void>((resolve) => started = resolve);
  await page.route("**/functions/v1/youtube", async (route) => {
    if (
      route.request().method() !== "POST" || route.request().postDataJSON().action !== "complete"
    ) return route.fallback();
    started();
    await pending;
    await route.fulfill({
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": origin },
      body: '{"connected":true}',
    });
  });
  await page.goto(home + "?youtube_callback=1&code=synthetic&state=synthetic");
  await seen;
  await other.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(other.getByRole("button", { name: "Sign in with Google" })).toBeVisible();
  complete();
  await expect(page.getByRole("button", { name: "Sign in with Google" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toHaveCount(0);
  await other.close();
});

test("Account connects workflow consent and returns to Account without storing provider data", async ({ page }) => {
  await signedIn(page);
  await page.route("**/functions/v1/youtube", async (route) => {
    const action = route.request().postDataJSON().action;
    await route.fulfill({
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": origin },
      json: action === "connect"
        ? { authorization_url: "https://accounts.google.com/synthetic" }
        : { connected: false, channel: null, expiresAt: null },
    });
  });
  await page.getByRole("link", { name: "Account", exact: true }).click();
  await expect(page.getByRole("button", { name: "Connect YouTube", exact: true })).toBeEnabled();
  await page.route(
    "https://accounts.google.com/**",
    (route) => route.fulfill({ contentType: "text/html", body: "Synthetic consent" }),
  );
  await page.getByRole("button", { name: "Connect YouTube", exact: true }).click();
  await expect(page).toHaveURL("https://accounts.google.com/synthetic");
  await page.goto(home + "?youtube_callback=1&error=access_denied");
  await expect(page).toHaveURL(home + "account");
  await expect(page.getByRole("status").filter({ hasText: "YouTube consent was declined" }))
    .toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem("videoalbum.return"))).toBeNull();
});

test("Account reports local disconnect separately from pending Google revocation", async ({ page }) => {
  await signedIn(page);
  await page.route("**/functions/v1/youtube", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": origin },
      json: route.request().postDataJSON().action === "connection"
        ? {
          connected: true,
          channel: { id: "synthetic-channel", title: "Workflow destination" },
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
        }
        : { disconnected: true, provider_revocation_pending: true },
    });
  });
  await page.getByRole("link", { name: "Account", exact: true }).click();
  await expect(page.locator("body")).toContainText("Workflow destination");
  await page.getByRole("button", { name: "Disconnect / retry Google revocation", exact: true })
    .click();
  await expect(page.locator("body")).toContainText(
    "Disconnected locally. Google access revocation is pending",
  );
  await expect(page.locator("body")).not.toContainText("Workflow destination");
  await expect(page.getByRole("button", { name: "Connect YouTube", exact: true })).toBeEnabled();
});

async function uploadBackend(page: Page) {
  await page.route("**/functions/v1/youtube", (route) =>
    route.fulfill({
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": origin },
      json: {
        connected: true,
        workflowId: owner,
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      },
    }));
}
test("upload Public warning is modal, preserves prior visibility on Cancel/Escape and never initiates uploads", async ({ page }) => {
  await signedIn(page);
  await uploadBackend(page);
  const actions: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/uploads") && request.method() === "POST") {
      actions.push(request.postDataJSON().action);
    }
  });
  await page.getByRole("link", { name: "Upload a video to YouTube" }).click();
  const selector = page.getByLabel("YouTube visibility");
  await expect(selector).toHaveValue("unlisted");
  await selector.selectOption("private");
  await selector.selectOption("public");
  const modal = page.getByRole("dialog", { name: "Use Public visibility?" });
  await expect(modal).toBeVisible();
  await expect(modal).toContainText(
    "Public videos can be found and watched by anyone on YouTube and may appear in search results or on your channel.",
  );
  await expect(page.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(modal).not.toBeVisible();
  await expect(selector).toHaveValue("private");
  await expect(selector).toBeFocused();
  await selector.selectOption("public");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(selector).toHaveValue("private");
  await selector.selectOption("public");
  await page.getByRole("button", { name: "Use Public", exact: true }).click();
  await expect(selector).toHaveValue("public");
  expect(actions).toEqual([]);
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await expect(page.getByRole("button", { name: "Stay here" })).toBeVisible();
  await page.getByRole("button", { name: "Leave screen", exact: true }).click();
  await page.getByRole("link", { name: "Upload a video to YouTube" }).click();
  await expect(selector).toHaveValue("unlisted");
  expect(actions).toEqual([]);
});

test("upload bookmarks and restored navigation only read owner state, never initiate or reuse Public confirmation", async ({ page }) => {
  await signedIn(page);
  await uploadBackend(page);
  const actions: string[] = [];
  await page.route("**/functions/v1/uploads", (route) => {
    const action = route.request().postDataJSON().action;
    actions.push(action);
    return route.fulfill({
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": origin },
      json: {
        jobId: owner,
        workflowId: owner,
        state: "transferring",
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        requestedVisibility: "public",
        effectiveVisibility: null,
        pollCount: 0,
        qrEligible: false,
        needsAnonymousPlayback: false,
      },
    });
  });
  await page.goto(home + `uploads/${owner}`);
  await expect(page.getByText("Upload status: transferring.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Resume same upload" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Start upload", exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("button", { name: "Resume same upload" })).toBeDisabled();
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Home", exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("button", { name: "Resume same upload" })).toBeDisabled();
  await expect(page).toHaveURL(home + `uploads/${owner}`);
  await expect.poll(() => actions.length).toBeGreaterThanOrEqual(3);
  expect(actions.every((action) => action === "status")).toBe(true);
  const stored = await page.evaluate(() =>
    JSON.stringify({
      url: location.href,
      history: history.state,
      local: { ...localStorage },
      tab: { ...sessionStorage },
    })
  );
  expect(stored).not.toContain("requestedVisibility");
  expect(stored).not.toContain("sessionUrl");
});

test("expired upload bookmark cannot recreate work and Private completion has no QR action", async ({ page }) => {
  await signedIn(page);
  await uploadBackend(page);
  await page.route(
    "**/functions/v1/uploads",
    (route) =>
      route.fulfill({
        status: 409,
        contentType: "application/json",
        headers: { "Access-Control-Allow-Origin": origin },
        json: { error: "workflow_unavailable" },
      }),
  );
  await page.goto(home + `uploads/${owner}`);
  await expect(
    page.getByText(
      "This upload is unavailable, expired or disconnected. Its bookmark cannot recreate it.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Start upload|Resume same upload|Prepare upload/ }))
    .toHaveCount(0);
  await page.route(
    "**/functions/v1/uploads",
    (route) =>
      route.fulfill({
        contentType: "application/json",
        headers: { "Access-Control-Allow-Origin": origin },
        json: {
          jobId: owner,
          workflowId: owner,
          state: "completed",
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
          requestedVisibility: "private",
          effectiveVisibility: "private",
          pollCount: 1,
          qrEligible: false,
          needsAnonymousPlayback: false,
        },
      }),
  );
  await page.reload();
  await expect(
    page.getByText("Private upload completed. Private videos cannot be used for QR codes."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /print|download|QR/i })).toHaveCount(0);
});

test("preparing a synthetic video saves metadata once and opens its app bookmark without dispatching", async ({ page }) => {
  await signedIn(page);
  await uploadBackend(page);
  const actions: string[] = [];
  await page.route("**/functions/v1/uploads", (route) => {
    const body = route.request().postDataJSON();
    actions.push(body.action);
    if (body.action === "create") {
      expect(body.title).toBe("Authored title");
      expect(body.description).toBe("Authored description");
      expect(body.caption).toBe("Independent caption");
      expect(body.visibility).toBe("public");
      expect(body.confirmPublic).toBe(true);
    }
    return route.fulfill({
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": origin },
      json: {
        jobId: owner,
        workflowId: owner,
        state: "queued",
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        requestedVisibility: "public",
        effectiveVisibility: null,
        pollCount: 0,
        qrEligible: false,
        needsAnonymousPlayback: false,
      },
    });
  });
  await page.getByRole("link", { name: "Upload a video to YouTube" }).click();
  await page.getByLabel("YouTube title").fill("Authored title");
  await page.getByLabel("YouTube description").fill("Authored description");
  await page.getByLabel("Album caption").fill("Independent caption");
  await page.getByLabel("YouTube visibility").selectOption("public");
  await page.getByRole("button", { name: "Use Public", exact: true }).click();
  await page.getByLabel("Is this video made for children?").selectOption("false");
  await page.getByLabel("MP4 video", { exact: true }).setInputFiles(
    "routing-e2e/fixtures/synthetic.mp4",
  );
  await page.getByRole("button", { name: "Prepare upload", exact: true }).click();
  await expect(page).toHaveURL(home + `uploads/${owner}`);
  await expect(page.getByRole("button", { name: "Start upload", exact: true })).toBeEnabled();
  expect(actions).toEqual(["create", "status"]);
  await expect(page.getByRole("button", { name: "Stay here" })).toHaveCount(0);
  const stored = await page.evaluate(() =>
    JSON.stringify({
      url: location.href,
      history: history.state,
      local: { ...localStorage },
      tab: { ...sessionStorage },
    })
  );
  expect(stored).not.toContain("Authored description");
  expect(stored).not.toContain("synthetic.mp4");
});

test("saved downloads survive verification expiry and finish only after explicit confirmation", async ({ page }) => {
  await page.clock.install();
  await signedIn(page);
  const actions: string[] = [];
  let completed = false;
  const destination = "https://www.youtube.com/watch?v=synthetic61";
  await page.route("**/functions/v1/uploads", (route) => {
    const body = route.request().postDataJSON();
    actions.push(body.action);
    if (body.action === "finish") {
      expect(body.confirmSaved).toBe(true);
      completed = true;
    }
    return route.fulfill({
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": origin },
      json: body.action === "delivery"
        ? completed ? { completed: true, workflowId: owner } : {
          workflowId: owner,
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
          albumId: owner,
          albumTitle: "Synthetic album",
          preset: 1,
          jobs: [{
            jobId: owner,
            caption: "Caption <script>alert(1)</script>",
            state: "uploaded",
            processing: "succeeded",
            visibility: "unlisted",
            qrEligible: true,
          }],
        }
        : body.action === "downloads"
        ? {
          workflowId: owner,
          batchId: owner,
          expiresAt: new Date(Date.now() + 240000).toISOString(),
          albumTitle: "Synthetic album",
          preset: 3,
          entries: [{
            jobId: owner,
            videoId: owner,
            caption: "Caption <script>alert(1)</script>",
            visibility: "unlisted",
            qrEligible: true,
            destination,
          }],
        }
        : body.action === "preprint"
        ? { state: "completed", qrEligible: true }
        : { acknowledged: true, completed: body.action === "finish" },
    });
  });
  await page.goto(home + `workflows/${owner}/print`);
  await page.getByRole("button", { name: "Verify destinations for printing" }).click();
  await expect(page.getByText(/Processing and visibility checks completed/)).toBeVisible();
  await expect(page.locator("body")).not.toContainText("playback verifier");
  expect(actions).toEqual(["delivery", "preprint", "delivery"]);
  await page.getByLabel("QR style").selectOption("3");
  await page.getByRole("checkbox", { name: /I have checked the intended/ }).check();
  await page.getByRole("button", { name: "Prepare verified files" }).click();
  const svg = page.locator(".qr-sheet svg");
  await expect(svg).toHaveAttribute("width", "32mm");
  await expect(svg.locator("path")).toHaveAttribute("fill", "#1d4b35");
  await expect(page.getByRole("button", { name: "Finish workflow" })).toBeDisabled();
  await page.emulateMedia({ media: "print" });
  await expect(page.getByRole("navigation")).toBeHidden();
  await expect(svg).toBeVisible();
  await page.emulateMedia({ media: "screen" });
  const sheetEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download A4 sheet" }).click();
  const sheet = await sheetEvent;
  const stream = await sheet.createReadStream();
  let html = "";
  for await (const chunk of stream!) html += chunk.toString();
  await sheet.delete();
  expect(html).toContain("size:A4");
  expect(html).toContain("&lt;script&gt;");
  expect(html).not.toContain("<script>");
  expect(html).not.toContain("upload_id");
  const codeEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: /Download SVG 1/ }).click();
  const code = await codeEvent;
  expect(code.suggestedFilename()).toMatch(/\.svg$/);
  await code.delete();
  const linksEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download captions and links" }).click();
  const links = await linksEvent;
  const jsonStream = await links.createReadStream();
  let json = "";
  for await (const chunk of jsonStream!) json += chunk.toString();
  await links.delete();
  expect(JSON.parse(json).entries[0].youtubeWatchUrl).toBe(destination);
  expect(JSON.parse(json).version).toBe(1);
  await expect(page.getByRole("button", { name: "Finish workflow" })).toBeDisabled();
  await page.clock.fastForward(240_001);
  await expect(page.locator(".qr-sheet")).toHaveCount(0);
  await expect(page.getByText(/Ready for QR/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Download A4 sheet" })).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: /I have saved the offered files/ }))
    .toBeEnabled();
  await page.getByRole("checkbox", { name: /I have saved the offered files/ }).check();
  await page.getByRole("button", { name: "Finish workflow" }).click();
  await expect(page.getByText(/Workflow completed. Temporary links/)).toBeVisible();
  expect(actions.filter((action) => action === "finish")).toHaveLength(1);
  await expect(page.locator(".qr-sheet")).toHaveCount(0);
  await page.reload();
  await expect(page.getByText(/Workflow completed. Temporary links/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Prepare verified files" })).toHaveCount(0);
  const stored = await page.evaluate(() =>
    JSON.stringify({
      url: location.href,
      history: history.state,
      local: { ...localStorage },
      tab: { ...sessionStorage },
    })
  );
  expect(stored).not.toContain("synthetic61");
});

test("Private-only workflow exports owner links but never offers a QR code or print action", async ({ page }) => {
  await page.clock.install();
  await signedIn(page);
  await page.route(
    "**/functions/v1/uploads",
    (route) =>
      route.fulfill({
        contentType: "application/json",
        headers: { "Access-Control-Allow-Origin": origin },
        json: route.request().postDataJSON().action === "delivery"
          ? {
            workflowId: owner,
            expiresAt: new Date(Date.now() + 86400000).toISOString(),
            albumId: owner,
            albumTitle: "Private fixture",
            preset: 1,
            jobs: [{
              jobId: owner,
              caption: "Private",
              state: "uploaded",
              processing: "succeeded",
              visibility: "private",
              qrEligible: false,
            }],
          }
          : {
            workflowId: owner,
            batchId: owner,
            expiresAt: new Date(Date.now() + 240000).toISOString(),
            albumTitle: "Private fixture",
            preset: 1,
            entries: [{
              jobId: owner,
              videoId: owner,
              caption: "Private",
              visibility: "private",
              qrEligible: false,
              destination: "https://www.youtube.com/watch?v=synthetic61",
            }],
          },
      }),
  );
  await page.goto(home + `workflows/${owner}/print`);
  await page.getByRole("checkbox", { name: /I have checked the intended/ }).check();
  await page.getByRole("button", { name: "Prepare verified files" }).click();
  await expect(page.getByRole("button", { name: "Download captions and links" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Download A4 sheet|Download SVG|Print \/ Save/ }))
    .toHaveCount(0);
  await expect(page.locator(".qr-sheet svg")).toHaveCount(0);
  await page.clock.fastForward(240_001);
  await expect(page.getByRole("button", { name: "Download captions and links" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Finish workflow" })).toHaveCount(0);
});

test("trusted verifier opens a clean context and requires actual anonymous player progress", async ({ browser }) => {
  let anonymous = false;
  const isolated = {
    newContext: async (options: Parameters<typeof browser.newContext>[0]) => {
      const context = await browser.newContext(options);
      anonymous = (await context.cookies()).length === 0;
      await context.route("https://www.youtube.com/iframe_api", (route) =>
        route.fulfill({
          contentType: "application/javascript",
          body:
            `globalThis.YT={Player:class {constructor(id,options){setTimeout(options.events.onReady,0)}mute(){}playVideo(){}destroy(){}getPlayerState(){return 1}getVideoUrl(){return 'https://www.youtube.com/watch?v=synthetic61'}getCurrentTime(){return performance.now()/1000}}};onYouTubeIframeAPIReady();`,
        }));
      return context;
    },
  };
  expect(await checkAnonymousPlayback(isolated, "https://example.test", "synthetic61")).toBe(true);
  expect(anonymous).toBe(true);
  const denied = {
    newContext: async (options: Parameters<typeof browser.newContext>[0]) => {
      const context = await browser.newContext(options);
      await context.route("https://www.youtube.com/iframe_api", (route) =>
        route.fulfill({
          contentType: "application/javascript",
          body:
            `globalThis.YT={Player:class {constructor(id,options){setTimeout(options.events.onError,0)}destroy(){}}};onYouTubeIframeAPIReady();`,
        }));
      return context;
    },
  };
  expect(await checkAnonymousPlayback(denied, "https://example.test", "synthetic61")).toBe(false);
});

test("QR readiness expires without preparing files", async ({ page }) => {
  await page.clock.install();
  const verifiedAt = new Date().toISOString();
  await signedIn(page);
  await page.route("**/functions/v1/uploads", (route) =>
    route.fulfill({
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": origin },
      json: {
        workflowId: owner,
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        albumId: owner,
        albumTitle: "Expiry test",
        preset: 1,
        jobs: [{
          jobId: owner,
          caption: "Fresh code",
          state: "uploaded",
          processing: "succeeded",
          visibility: "unlisted",
          qrEligible: true,
          verifiedAt,
        }],
      },
    }));
  await page.goto(home + `workflows/${owner}/print`);
  await expect(page.getByText(/Ready for QR/)).toBeVisible();
  await page.clock.fastForward(300_001);
  await expect(page.getByText(/Ready for QR/)).toHaveCount(0);
  await expect(page.getByText(/uploaded — verification required/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Finish workflow" })).toHaveCount(0);
});

test("reload restores only saved completion and workflow expiry removes it", async ({ page }) => {
  await page.clock.install();
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  await signedIn(page);
  let finishes = 0;
  await page.route("**/functions/v1/uploads", (route) => {
    if (route.request().postDataJSON().action === "finish") finishes++;
    return route.fulfill({
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": origin },
      json: {
        workflowId: owner,
        expiresAt,
        albumId: owner,
        albumTitle: "Saved receipt",
        preset: 1,
        savedBatchId: owner,
        jobs: [],
      },
    });
  });
  await page.goto(home + `workflows/${owner}/print`);
  await expect(page.getByRole("checkbox", { name: /I have saved the offered files/ }))
    .toBeEnabled();
  await expect(page.getByRole("button", { name: "Finish workflow" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Download A4 sheet" })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("checkbox", { name: /I have saved the offered files/ }))
    .toBeEnabled();
  await page.clock.fastForward(60_001);
  await expect(page.getByRole("button", { name: "Finish workflow" })).toHaveCount(0);
  expect(finishes).toBe(0);
});

test("a selected resume file guards active work but completed upload navigation is immediate", async ({ page }) => {
  await signedIn(page);
  await uploadBackend(page);
  await page.route("**/functions/v1/uploads", (route) =>
    route.fulfill({
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": origin },
      json: {
        jobId: owner,
        workflowId: owner,
        state: route.request().postDataJSON().action === "reconcile" ? "completed" : "transferring",
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        requestedVisibility: "unlisted",
        effectiveVisibility: "unlisted",
        pollCount: 1,
        qrEligible: false,
        needsAnonymousPlayback: true,
      },
    }));
  await page.goto(home + `uploads/${owner}`);
  await page.getByLabel("Reselect the original MP4 file").setInputFiles(
    "routing-e2e/fixtures/synthetic.mp4",
  );
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await expect(page.getByRole("button", { name: "Stay here" })).toBeVisible();
  await page.getByRole("button", { name: "Stay here" }).click();
  await page.getByRole("button", { name: "Check processing / recover completion" }).click();
  await expect(page.getByText(/Upload status: completed/)).toBeVisible();
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Home", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Stay here" })).toHaveCount(0);
});
