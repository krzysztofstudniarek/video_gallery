// Capture once, before health/Auth/API requests. Never render or log callback data.
const url = new URL(location.href);
const youtubeCallback = url.searchParams.get("youtube_callback") === "1";
export const authCode = youtubeCallback ? null : url.searchParams.get("code");
export const authDenied = !youtubeCallback && url.searchParams.has("error");
let youtube = {
  youtubeCallback,
  consentCode: youtubeCallback ? url.searchParams.get("code") : null,
  consentState: youtubeCallback ? url.searchParams.get("state") : null,
  consentDenied: youtubeCallback && url.searchParams.has("error"),
};
if (youtubeCallback || authCode || url.searchParams.has("error") || url.hash) {
  history.replaceState(null, "", location.pathname);
}
export function takeYoutubeCallback() {
  const result = youtube;
  youtube = { youtubeCallback: false, consentCode: null, consentState: null, consentDenied: false };
  return result;
}
