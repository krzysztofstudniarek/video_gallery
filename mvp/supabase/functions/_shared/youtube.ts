export const scopes = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
];
export const maxBytes = 10 * 1024 * 1024;
export const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
export function unbase64(value: string) {
  return Uint8Array.from(atob(value), (x) => x.charCodeAt(0));
}
export function randomSecret() {
  return base64(crypto.getRandomValues(new Uint8Array(32))).replaceAll("+", "-").replaceAll(
    "/",
    "_",
  ).replaceAll("=", "");
}
export async function hash(value: string) {
  return base64(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))),
  )
    .replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
async function key(encoded: string) {
  const raw = unbase64(encoded);
  if (raw.length !== 32) throw new Error("configuration");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}
export async function seal(encodedKey: string, owner: string, kind: string, value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(value);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(`${owner}:${kind}:v1`) },
    await key(encodedKey),
    data,
  );
  return JSON.stringify({ v: 1, iv: base64(iv), data: base64(new Uint8Array(encrypted)) });
}
export async function unseal(encodedKey: string, owner: string, kind: string, envelope: string) {
  const box = JSON.parse(envelope);
  if (box.v !== 1) throw new Error("key_version");
  const value = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: unbase64(box.iv),
      additionalData: new TextEncoder().encode(`${owner}:${kind}:v1`),
    },
    await key(encodedKey),
    unbase64(box.data),
  );
  return new TextDecoder().decode(value);
}
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
