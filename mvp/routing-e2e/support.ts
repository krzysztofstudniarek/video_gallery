import { expect, type Page } from "@playwright/test";

export const origin = "http://127.0.0.1:5174";
export const base = process.env.ROUTING_BASE_PATH || "/";
export const home = origin + base;
export const owner = "00000000-0000-4000-8000-000000000026";
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
export async function mockBackend(page: Page) {
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
      if (action === "start") await new Promise((resolve) => setTimeout(resolve, 250));
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
export async function signedIn(page: Page, path = "") {
  await mockBackend(page);
  await page.goto(home);
  await page.evaluate(
    (value) => localStorage.setItem("videoalbum.auth", JSON.stringify(value)),
    session,
  );
  await page.goto(home + path);
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
}
