export const scopes = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
];
export const maxBytes = 10 * 1024 * 1024;
export function authorizeUrl(clientId: string, redirect: string, state: string, challenge: string) {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirect,
    response_type: "code",
    scope: scopes.join(" "),
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    access_type: "offline",
    prompt: "consent select_account",
  }).toString();
  return url.href;
}
export function sessionUrl(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" || url.hostname !== "www.googleapis.com" ||
    url.username || url.password || url.port ||
    !url.pathname.startsWith("/upload/youtube/v3/videos")
  ) throw new Error("invalid_session");
  return url.href;
}
export async function googleJson(send: typeof fetch, url: string, init: RequestInit = {}) {
  const response = await send(url, {
    ...init,
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    if (response.status === 401) throw new Error("reconnect_youtube");
    throw new Error("google_request_failed");
  }
  return response.json();
}
export async function tokenRequest(
  send: typeof fetch,
  clientId: string,
  secret: string,
  fields: Record<string, string>,
) {
  const body = new URLSearchParams({ ...fields, client_id: clientId, client_secret: secret });
  const response = await send("https://oauth2.googleapis.com/token", {
    method: "POST",
    body,
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    if (response.status === 400 || response.status === 401) throw new Error("reconnect_youtube");
    throw new Error("google_request_failed");
  }
  const result = await response.json();
  if (typeof result.access_token !== "string" || !result.access_token) {
    throw new Error("reconnect_youtube");
  }
  return result;
}
export function uploadBody(jobId: string, madeForKids: boolean) {
  return {
    snippet: {
      title: "VideoAlbum staging upload test",
      description: `VideoAlbum probe ${jobId}`,
      categoryId: "22",
    },
    status: { privacyStatus: "unlisted", selfDeclaredMadeForKids: madeForKids },
  };
}
