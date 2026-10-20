import { createClient } from "@supabase/supabase-js";
import { directUpload } from "./direct-upload";

// Capture and remove Google's one-time callback values before any API request.
const callback = new URL(location.href);
const youtubeCallback = callback.searchParams.get("youtube_callback") === "1";
const consentCode = youtubeCallback ? callback.searchParams.get("code") : null;
const consentState = youtubeCallback ? callback.searchParams.get("state") : null;
const consentDenied = youtubeCallback && callback.searchParams.has("error");
if (youtubeCallback) history.replaceState(null, "", location.pathname);

const connection = document.querySelector("#connection")!;
fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/health`)
  .then(async (response) => {
    const data = await response.json();
    if (!response.ok || data.status !== "ok" || data.application !== "videoalbum") {
      throw new Error("health");
    }
    connection.textContent = "Supabase backend connected";
  })
  .catch(() => {
    connection.textContent = "Backend unavailable; check deployment configuration.";
  });

const client = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  {
    auth: { flowType: "pkce", detectSessionInUrl: !youtubeCallback },
  },
);
const output = document.querySelector("output")!;
document.querySelector("#signin")!.addEventListener("click", async () => {
  const { error } = await client.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: new URL(import.meta.env.BASE_URL, location.origin).href },
  });
  if (error) output.textContent = "Google sign-in failed; check provider configuration.";
});
document.querySelector("#signout")!.addEventListener("click", async () => {
  paused = true;
  video = null;
  channel = null;
  await client.auth.signOut();
  document.querySelector("#youtube-status")!.textContent = "Signed out";
  output.textContent = "Signed out";
});
document.querySelector("#probe")!.addEventListener("click", async () => {
  const { data, error } = await client.functions.invoke("compatibility", { body: {} });
  output.textContent = error
    ? "Probe failed; check sign-in and the staging backend."
    : JSON.stringify(data);
});

type Channel = { id: string; title: string };
let channel: Channel | null = null;
let video: string | null = null;
let paused = false;
let busy = false;
const youtubeStatus = document.querySelector("#youtube-status")!;
const errors: Record<string, string> = {
  sign_in_required: "Sign in to VideoAlbum first.",
  youtube_not_configured: "YouTube consent is not configured on the backend yet.",
  consent_expired_or_used: "Consent expired or was already used. Start Connect YouTube again.",
  consent_missing_permissions:
    "Consent must include upload and read permissions with offline access. Connect again.",
  choose_one_youtube_channel: "Choose a Google account with one selected YouTube channel.",
  disconnect_before_switching_channel:
    "Disconnect the old channel before connecting a different channel.",
  reconnect_youtube: "Google access expired or was revoked. Connect YouTube again.",
  existing_probe_resume_or_clear:
    "An existing probe is reserved. Resume it; do not start a duplicate.",
  no_resumable_probe:
    "No saved session is available. Check YouTube Studio before clearing the probe.",
  choose_original_file: "Choose the exact original file; size and SHA-256 must match.",
  visibility_not_unlisted:
    "Blocked: YouTube reports a visibility other than Unlisted. Do not print or share this video.",
  upload_processing_failed:
    "YouTube processing failed or the video was rejected/deleted. Check YouTube Studio before retrying.",
  video_not_this_probe: "The video does not match this channel and upload probe.",
  youtube_probe_failed:
    "YouTube probe failed. Do not retry initiation blindly; check connection and the existing probe.",
  upload_initiation_failed:
    "YouTube rejected initiation. The probe reservation is retained; check before clearing.",
  revocation_failed:
    "Google revocation failed; the connection was retained so you can retry disconnect.",
};
async function youtube(action: string, values: Record<string, unknown> = {}) {
  const { data, error } = await client.functions.invoke("youtube", { body: { action, ...values } });
  if (error) {
    let code = "youtube_probe_failed";
    try {
      code = (await error.context.json()).error ?? code;
    } catch { /* Network errors have no JSON context. */ }
    throw new Error(
      errors[code] ?? "YouTube request failed. Check sign-in and staging configuration.",
    );
  }
  return data;
}
async function status() {
  const result = await youtube("status");
  channel = result.channel;
  youtubeStatus.textContent = !result.configured
    ? "YouTube backend needs OAuth client and encryption-key configuration."
    : channel
    ? `Connected destination: ${channel.title} (${channel.id}). ${
      result.job ? "An upload probe already exists." : "No upload probe reserved."
    }`
    : "YouTube is not connected.";
}
async function run(action: () => Promise<void>) {
  if (busy) return;
  busy = true;
  const buttons = [...document.querySelectorAll<HTMLButtonElement>("button")];
  for (const button of buttons) if (button.id !== "youtube-pause") button.disabled = true;
  try {
    await action();
  } catch (error) {
    output.textContent = error instanceof Error ? error.message : "Request failed";
  } finally {
    busy = false;
    for (const button of buttons) button.disabled = false;
  }
}
function button(id: string, action: () => Promise<void>) {
  document.querySelector(`#${id}`)!.addEventListener("click", () => run(action));
}
button("youtube-connect", async () => {
  const result = await youtube("start");
  const url = new URL(result.authorization_url);
  if (url.origin !== "https://accounts.google.com") {
    throw new Error("Unexpected consent destination");
  }
  location.assign(url.href);
});
button("youtube-status-refresh", status);
button("youtube-refresh", async () => {
  await youtube("refresh");
  output.textContent = "Server-side Google token refresh passed.";
});
button("youtube-disconnect", async () => {
  await youtube("disconnect");
  channel = null;
  video = null;
  await status();
  output.textContent = "YouTube access revoked and local credentials removed.";
});
async function fileData() {
  const file = document.querySelector<HTMLInputElement>("#youtube-file")!.files?.[0];
  if (!file || file.size < 1 || file.size > 10 * 1024 * 1024 || file.type !== "video/mp4") {
    throw new Error("Choose a nonempty MP4 up to 10 MiB.");
  }
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer()));
  const sha256 = [...digest].map((x) => x.toString(16).padStart(2, "0")).join("");
  return { file, sha256 };
}
async function transfer(session: string, file: File) {
  paused = false;
  video = await directUpload(session, file, (bytes) => {
    document.querySelector<HTMLProgressElement>("#youtube-progress")!.value = bytes * 100 /
      file.size;
  }, () => paused);
  output.textContent = video
    ? "Transfer completed. Check processing and Unlisted status next."
    : "Paused. Resume this existing probe with the same file.";
}
button("youtube-upload", async () => {
  if (!channel || !document.querySelector<HTMLInputElement>("#youtube-unlisted")!.checked) {
    throw new Error("Connect YouTube and confirm the displayed channel and Unlisted visibility.");
  }
  const kids = document.querySelector<HTMLSelectElement>("#youtube-kids")!.value;
  if (!kids) throw new Error("Choose whether this test video is made for kids.");
  const { file, sha256 } = await fileData();
  const result = await youtube("initiate", {
    channel_id: channel.id,
    confirmed_unlisted: true,
    size: file.size,
    mime: file.type,
    made_for_kids: kids === "yes",
    sha256,
  });
  await transfer(result.session_url, file);
});
document.querySelector("#youtube-pause")!.addEventListener("click", () => {
  paused = true;
});
button("youtube-resume", async () => {
  const { file, sha256 } = await fileData();
  const result = await youtube("resume", { size: file.size, sha256 });
  await transfer(result.session_url, file);
});
button("youtube-verify", async () => {
  if (!video) throw new Error("Resume/check the completed upload first to recover its result.");
  const result = await youtube("verify", { video_id: video });
  output.textContent = result.ready
    ? "Verified: processing completed and visibility is Unlisted. Get the watch link from YouTube Studio and check playback in a signed-out browser."
    : `Unlisted verified; processing status: ${result.processing}. Check again shortly.`;
});
button("youtube-clear", async () => {
  if (
    !confirm(
      "Clear only the local probe record? This does not delete or cancel anything on YouTube. Check YouTube Studio first.",
    )
  ) return;
  await youtube("clear_job");
  video = null;
  await status();
});
void run(async () => {
  const { data } = await client.auth.getSession();
  if (!data.session) {
    if (youtubeCallback) {
      output.textContent = "Sign-in session missing. Sign in, then start Connect YouTube again.";
    }
    return;
  }
  if (consentDenied) output.textContent = "YouTube consent was declined. No upload was started.";
  else if (youtubeCallback && consentCode && consentState) {
    await youtube("complete", { code: consentCode, state: consentState });
    output.textContent = "YouTube consent saved. Confirm the destination channel before uploading.";
  }
  await status();
});
