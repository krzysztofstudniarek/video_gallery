import { pathToFileURL } from "node:url";

// No profile, storage state, recording, screenshots, downloads, request logging or saved media.
// The signed-out player must actually advance for the requested video; metadata/oEmbed is insufficient.
export async function checkAnonymousPlayback(browser, origin, videoId) {
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) return false;
  const context = await browser.newContext({ acceptDownloads: false, serviceWorkers: "block" });
  try {
    const page = await context.newPage();
    const host = new URL("/__anonymous-playback-check", origin).href;
    await page.route(
      host,
      (route) =>
        route.fulfill({
          contentType: "text/html",
          body: '<!doctype html><html><body><div id="player"></div></body></html>',
        }),
    );
    await page.goto(host, { timeout: 10000 });
    return await page.evaluate((id) =>
      new Promise((resolve) => {
        let player, sample = null, interval, finished = false;
        const finish = (passed) => {
          if (finished) return;
          finished = true;
          clearTimeout(timeout);
          clearInterval(interval);
          player?.destroy();
          resolve(passed);
        };
        const timeout = setTimeout(() => finish(false), 45000);
        globalThis.onYouTubeIframeAPIReady = () => {
          player = new globalThis.YT.Player("player", {
            width: 640,
            height: 390,
            videoId: id,
            playerVars: { playsinline: 1, origin: location.origin },
            events: {
              onReady: () => {
                player.mute();
                player.playVideo();
              },
              onError: () => finish(false),
            },
          });
          interval = setInterval(() => {
            if (!player?.getPlayerState || !player.getVideoUrl) return;
            const url = new URL(player.getVideoUrl());
            if (url.searchParams.get("v") !== id) {
              finish(false);
              return;
            }
            const time = player.getCurrentTime(), state = player.getPlayerState();
            if (state === 1) {
              if (sample === null) sample = time;
              else if (time > sample + 0.25) finish(true);
            }
          }, 100);
        };
        const script = document.createElement("script");
        script.src = "https://www.youtube.com/iframe_api";
        script.onerror = () => finish(false);
        document.head.append(script);
      }), videoId);
  } finally {
    await context.close();
  }
}

export async function runPlaybackWorker(
  { client, browser, origin, limit = 10, check = checkAnonymousPlayback },
) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 10) {
    throw new Error("Invalid worker batch limit");
  }
  const url = new URL(origin);
  if (
    url.origin !== origin ||
    (url.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(url.hostname))
  ) throw new Error("Invalid verifier origin");
  const summary = { checked: 0, passed: 0, failed: 0, discarded: 0 };
  for (let n = 0; n < limit; n++) {
    const claim = crypto.randomUUID();
    const next = await client.rpc("claim_upload_playback", { p_claim: claim });
    if (next.error) throw new Error("Playback queue unavailable");
    if (!next.data) break;
    let passed = false;
    try {
      passed = await check(browser, origin, next.data.videoId);
    } catch { /* Challenges, network and player errors fail closed. */ }
    const stored = await client.rpc("finish_upload_playback", { p_claim: claim, p_passed: passed });
    if (stored.error) throw new Error("Playback result could not be committed");
    summary.checked++;
    if (!stored.data) summary.discarded++;
    else if (passed) summary.passed++;
    else summary.failed++;
  }
  return summary;
}

async function main() {
  const url = process.env.SUPABASE_URL,
    key = process.env.SUPABASE_SERVICE_ROLE_KEY,
    origin = process.env.FRONTEND_ORIGIN;
  if (!url || !key || !origin) throw new Error("Verifier backend configuration missing");
  if (
    new URL(url).protocol !== "https:" &&
    !["localhost", "127.0.0.1"].includes(new URL(url).hostname)
  ) throw new Error("Invalid verifier backend");
  const { createClient } = await import("@supabase/supabase-js"),
    { chromium } = await import("playwright");
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
  try {
    console.log(JSON.stringify(await runPlaybackWorker({ client, browser, origin })));
  } finally {
    await browser.close();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error("Anonymous playback verification failed; no provider details logged.");
    process.exitCode = 1;
  });
}
