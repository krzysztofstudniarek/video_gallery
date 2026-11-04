import { chromium, expect, type Page, test } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { admin, createAccount } from "./local";
import type { Session } from "@supabase/supabase-js";

const base = "http://127.0.0.1:5173";
const ids: string[] = [];
async function account() {
  const result = await createAccount();
  ids.push(result.id);
  return result;
}
async function signIn(page: Page, session: Session, tools = false) {
  await page.goto(tools ? `${base}/?tools=1` : `${base}/account`);
  await expect(page.getByRole("button", { name: "Sign in with Google" })).toBeVisible();
  await page.evaluate(
    (value) => localStorage.setItem("videoalbum.auth", JSON.stringify(value)),
    session,
  );
  await page.reload();
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
  if (!tools) {
    await expect(page.getByRole("heading", { name: "Delete account", exact: true })).toBeVisible();
  }
}
test.afterEach(async () => {
  for (const id of ids.splice(0)) {
    const removed = await admin.auth.admin.deleteUser(id);
    if (removed.error && removed.error.status !== 404) {
      throw new Error("Browser fixture cleanup failed");
    }
    const tasks = await admin.rpc("pending_provider_revocations", { p_owner: id });
    for (const row of tasks.data ?? []) {
      await admin.rpc("finish_provider_revocation", { p_id: row.id });
    }
  }
});

test("Google callback errors are scrubbed and login requests only identity scopes with PKCE", async ({ page }) => {
  await page.goto(`${base}/?error=access_denied&error_description=sensitive-callback`);
  await expect(page.getByText("Google sign-in did not complete. Please try again.")).toBeVisible();
  expect(page.url()).toBe(`${base}/`);
  await expect(page.locator("body")).not.toContainText("sensitive-callback");
  await page.route(
    "**/auth/v1/authorize?**",
    (route) => route.fulfill({ contentType: "text/html", body: "Synthetic OAuth destination" }),
  );
  const request = page.waitForRequest((req) => req.url().includes("/auth/v1/authorize?"));
  await page.getByRole("button", { name: "Sign in with Google" }).click();
  const url = new URL((await request).url());
  expect(url.searchParams.get("provider")).toBe("google");
  expect(url.searchParams.get("redirect_to")).toBe(`${base}/`);
  expect(url.searchParams.get("code_challenge_method")).toBe("s256");
  expect(url.searchParams.get("scopes")).toBe("openid email profile");
  expect(url.searchParams.get("prompt")).toBe("select_account");
});

test("persistent SDK session survives closing and reopening the browser without storing provider tokens", async () => {
  const user = await account();
  const dir = await mkdtemp(join(tmpdir(), "videoalbum-browser-profile-"));
  const options = { headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined };
  let context = await chromium.launchPersistentContext(dir, options);
  try {
    let page = context.pages()[0];
    await signIn(page, {
      ...user.session,
      provider_token: "sensitive-provider-token",
      provider_refresh_token: "sensitive-provider-refresh",
    });
    const saved = await page.evaluate(() => localStorage.getItem("videoalbum.auth"));
    expect(saved).not.toContain("sensitive-provider");
    await context.close();
    context = await chromium.launchPersistentContext(dir, options);
    page = context.pages()[0];
    await page.goto(`${base}/account`);
    await expect(page.getByText(`Signed in as ${user.email}.`)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Delete account", exact: true })).toBeVisible();
  } finally {
    await context.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("successful login exchanges one PKCE code and removes callback values before API requests", async ({ page }) => {
  const user = await account();
  let exchanges = 0;
  await page.goto(base);
  await page.evaluate(() =>
    localStorage.setItem("videoalbum.auth-code-verifier", JSON.stringify("synthetic-verifier"))
  );
  await page.route("**/auth/v1/token?grant_type=pkce", async (route) => {
    exchanges++;
    expect(route.request().postDataJSON()).toMatchObject({
      auth_code: "synthetic-code",
      code_verifier: "synthetic-verifier",
    });
    await route.fulfill({
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": base },
      body: JSON.stringify(user.session),
    });
  });
  await page.goto(`${base}/?code=synthetic-code`);
  await expect(page.getByRole("heading", { name: "Home", exact: true })).toBeVisible();
  expect(page.url()).toBe(`${base}/`);
  expect(exchanges).toBe(1);
});

test("browser CSP blocks injected inline scripts", async ({ page }) => {
  await page.goto(base);
  const blocked = await page.evaluate(async () => {
    const result = new Promise<boolean>((resolve) => {
      document.addEventListener(
        "securitypolicyviolation",
        (event) => resolve(event.blockedURI === "inline"),
        { once: true },
      );
    });
    const script = document.createElement("script");
    script.textContent = "window.__injected = true";
    document.body.append(script);
    return await result && !("__injected" in window);
  });
  expect(blocked).toBe(true);
});

test("two browser accounts show only their own channel and sign-out clears private UI", async ({ browser }) => {
  const a = await account(), b = await account();
  for (const [user, title] of [[a, "Channel A"], [b, "Channel B"]] as const) {
    const seeded = await admin.rpc("yt_probe_save", {
      p_owner: user.id,
      p_cipher: "synthetic",
      p_channel: "synthetic",
      p_title: title,
    });
    expect(seeded.error).toBeNull();
  }
  const ca = await browser.newContext(), cb = await browser.newContext();
  try {
    const pa = await ca.newPage(), pb = await cb.newPage();
    await signIn(pa, a.session, true);
    await signIn(pb, b.session, true);
    await expect(pa.locator("#youtube-status")).toContainText("Channel A");
    await expect(pa.locator("body")).not.toContainText("Channel B");
    await expect(pb.locator("#youtube-status")).toContainText("Channel B");
    const otherTab = await ca.newPage();
    await otherTab.goto(`${base}/?tools=1`);
    await expect(otherTab.locator("#youtube-status")).toContainText("Channel A");
    await pa.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(pa.getByRole("button", { name: "Sign in with Google" })).toBeVisible();
    await expect(pa.locator("body")).not.toContainText("Channel A");
    expect(await pa.evaluate(() => localStorage.getItem("videoalbum.auth"))).toBeNull();
    await expect(pb.locator("#youtube-status")).toContainText("Channel B");
    await expect(otherTab.getByRole("button", { name: "Sign in with Google" })).toBeVisible();
    await expect(otherTab.locator("body")).not.toContainText("Channel A");
  } finally {
    await ca.close();
    await cb.close();
  }
});

test("expired stored access token refreshes through SDK and revoked refresh signs out", async ({ page }) => {
  const user = await account();
  const session = { ...user.session, expires_at: 1, expires_in: 0 };
  const refreshed = page.waitForRequest((request) =>
    request.url().includes("grant_type=refresh_token")
  );
  await signIn(page, session);
  await refreshed;
  await page.evaluate(() => {
    const session = JSON.parse(localStorage.getItem("videoalbum.auth")!);
    session.expires_at = 1;
    session.refresh_token = "invalid-synthetic-refresh";
    localStorage.setItem("videoalbum.auth", JSON.stringify(session));
  });
  await page.reload();
  await expect(page.getByRole("button", { name: "Sign in with Google" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "YouTube upload validation" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Your videos" })).toHaveCount(0);
});

test("account deletion requires confirmation, clears private view and deletes the Auth identity", async ({ page }) => {
  const user = await account();
  await signIn(page, user.session);
  const button = page.getByRole("button", { name: "Delete my account", exact: true });
  await expect(button).toBeDisabled();
  await page.getByRole("checkbox", {
    name: "I understand that my VideoAlbum data will be permanently deleted.",
  }).check();
  await button.click();
  await expect(page.getByRole("button", { name: "Sign in with Google" })).toBeVisible();
  await expect(page.getByText(/Your VideoAlbum account was deleted/)).toBeVisible();
  expect((await admin.auth.admin.getUserById(user.id)).error?.status).toBe(404);
  expect(await page.evaluate(() => localStorage.getItem("videoalbum.auth"))).toBeNull();
});

test("pending deletion hides tools and presents a usable retry", async ({ page }) => {
  const user = await account();
  await signIn(page, user.session);
  await page.route("**/functions/v1/account", async (route) => {
    if (route.request().postDataJSON().action !== "delete") return route.continue();
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": base },
      body: JSON.stringify({ deleted: false, deletion_requested: true }),
    });
  });
  await page.getByRole("checkbox", {
    name: "I understand that my VideoAlbum data will be permanently deleted.",
  }).check();
  await page.getByRole("button", { name: "Delete my account", exact: true }).click();
  await expect(
    page.getByText(
      "App access is blocked while account deletion finishes. You can retry deletion below.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "YouTube upload validation" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Your videos" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Retry account deletion" })).toBeEnabled();
  await page.unroute("**/functions/v1/account");
  await page.getByRole("button", { name: "Retry account deletion" }).click();
  await expect(page.getByRole("button", { name: "Sign in with Google" })).toBeVisible();
});
