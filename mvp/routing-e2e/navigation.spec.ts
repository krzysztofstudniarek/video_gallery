import { expect, type Page, test } from "@playwright/test";

const origin = "http://127.0.0.1:5174";
const base = process.env.ROUTING_BASE_PATH || "/";
const home = origin + base;
const owner = "00000000-0000-4000-8000-000000000026";
const token = [
  btoa(JSON.stringify({ alg: "HS256" })),
  btoa(JSON.stringify({ sub: owner, exp: 4102444800 })),
  "synthetic",
].join(".");
const session = {
  access_token: token,
  refresh_token: "synthetic-refresh",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: 4102444800,
  user: {
    id: owner,
    aud: "authenticated",
    role: "authenticated",
    email: "routing@example.test",
    app_metadata: {},
    user_metadata: {},
    created_at: "2026-01-01T00:00:00Z",
  },
};
async function mockBackend(page: Page) {
  await page.route("http://127.0.0.1:54321/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    let body: unknown = {};
    if (path.endsWith("/health")) body = { status: "ok", application: "videoalbum" };
    else if (path.endsWith("/account")) {
      body = { user: { id: owner, email: "routing@example.test" }, deletion_requested: false };
    } else if (path.includes("/rest/")) body = [];
    else if (path.endsWith("/channel-library")) body = { connected: false };
    else if (path.endsWith("/youtube")) {
      const action = request.method() === "POST" ? request.postDataJSON().action : "";
      body = action === "start"
        ? { authorization_url: "https://accounts.google.com/synthetic" }
        : { configured: true, channel: { id: "synthetic", title: "Synthetic channel" }, job: null };
    } else if (path.endsWith("/token")) body = session;
    else if (path.endsWith("/user")) body = session.user;
    await route.fulfill({
      contentType: "application/json",
      headers: {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      },
      body: JSON.stringify(body),
    });
  });
}
async function signedIn(page: Page, path = "") {
  await mockBackend(page);
  await page.goto(home);
  await page.evaluate(
    (value) => localStorage.setItem("videoalbum.auth", JSON.stringify(value)),
    session,
  );
  await page.goto(home + path);
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
}

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

test("leaving a selection is explicit and sign-out then Back cannot expose private content", async ({ page }) => {
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
  await expect(page.getByRole("heading", { name: "Leave this screen?", exact: true }))
    .toBeVisible();
  await page.getByRole("button", { name: "Stay here" }).click();
  await expect(page).toHaveURL(home + "videos");
  await page.getByRole("link", { name: "Account", exact: true }).click();
  await page.getByRole("button", { name: "Leave screen", exact: true }).click();
  await expect(page).toHaveURL(home + "account");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sign in with Google" })).toBeVisible();
  await page.goBack();
  await expect(page.locator("body")).not.toContainText("Synthetic private selection");
  await expect(page.getByRole("heading", { name: "Your videos", exact: true })).toHaveCount(0);
});

test("Back navigation protects selection and returning never restores the old selection", async ({ page }) => {
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
  await expect(page.getByRole("button", { name: "Stay here" })).toBeVisible();
  await page.getByRole("button", { name: "Stay here" }).click();
  await expect(page).toHaveURL(home + "videos");
  await page.goBack();
  await page.getByRole("button", { name: "Leave screen", exact: true }).click();
  await expect(page).toHaveURL(home);
  await page.goForward();
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
