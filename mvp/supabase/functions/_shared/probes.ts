export async function encryptionProbe(): Promise<boolean> {
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt",
  ]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode("synthetic-refresh-token");
  const aad = new TextEncoder().encode("spike:v1:synthetic-owner");
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: aad },
    key,
    data,
  );
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv, additionalData: aad },
    key,
    encrypted,
  );
  return new TextDecoder().decode(plain) === "synthetic-refresh-token";
}

export async function oauthProbe(send: typeof fetch) {
  const refresh = await send("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: "synthetic",
      client_id: "synthetic",
      client_secret: "synthetic",
    }),
  });
  if (!refresh.ok) throw new Error("refresh_failed");
  const { access_token } = await refresh.json();
  if (typeof access_token !== "string" || !access_token) throw new Error("invalid_refresh");
  const upload = await send(
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${access_token}`,
        "Content-Type": "application/json",
        "X-Upload-Content-Type": "video/mp4",
        "X-Upload-Content-Length": "1",
      },
      body: JSON.stringify({
        snippet: { title: "Synthetic probe" },
        status: { privacyStatus: "unlisted" },
      }),
    },
  );
  if (!upload.ok) throw new Error("initiation_failed");
  const location = new URL(upload.headers.get("location") ?? "invalid");
  if (location.protocol !== "https:" || location.hostname !== "www.googleapis.com") {
    throw new Error("invalid_session");
  }
  return { refresh: true, initiation: true, privacy: "unlisted" };
}

export const syntheticFetch: typeof fetch = (input) =>
  Promise.resolve(
    String(input).includes("oauth2.googleapis.com")
      ? Response.json({ access_token: "synthetic" })
      : new Response(null, {
        headers: { Location: "https://www.googleapis.com/upload/synthetic" },
      }),
  );
