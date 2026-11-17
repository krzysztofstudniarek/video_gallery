import { ActionError } from "./youtube/errors.ts";
import { sessionUrl } from "./youtube/google.ts";
import type { ProviderVideo } from "./upload-policy.ts";

export async function providerJson(send: typeof fetch, url: string, init: RequestInit) {
  const response = await send(url, {
    ...init,
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const reasons = body.error?.errors?.map((error: { reason?: string }) => error.reason) ?? [];
    if (
      reasons.some((reason: string) =>
        ["quotaExceeded", "dailyLimitExceeded", "uploadLimitExceeded"].includes(reason)
      )
    ) {
      throw new ActionError("youtube_quota_exceeded", 429);
    }
    if (response.status === 401 || body.error === "invalid_grant") {
      throw new ActionError("reconnect_youtube", 409);
    }
    throw new ActionError("youtube_temporarily_unavailable", 502);
  }
  return body;
}
export async function startProviderUpload(
  send: typeof fetch,
  token: string,
  origin: string,
  size: number,
  metadata: unknown,
) {
  const response = await send(
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
    {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(15000),
      headers: {
        Authorization: `Bearer ${token}`,
        Origin: origin,
        "Content-Type": "application/json",
        "X-Upload-Content-Type": "video/mp4",
        "X-Upload-Content-Length": String(size),
      },
      body: JSON.stringify(metadata),
    },
  );
  if (!response.ok) {
    if (response.status === 401) throw new ActionError("reconnect_youtube", 409);
    // The claim remains consumed even if the provider's failure is unambiguous.
    const result = await response.json().catch(() => ({}));
    const reason = result.error?.errors?.[0]?.reason;
    throw new ActionError(
      ["quotaExceeded", "dailyLimitExceeded", "uploadLimitExceeded"].includes(reason)
        ? "youtube_quota_exceeded"
        : "initiation_uncertain_reconcile",
      response.status === 403 ? 429 : 502,
    );
  }
  await response.body?.cancel();
  return sessionUrl(response.headers.get("Location") ?? "");
}
// Empty status PUT is authoritative for binding a video to this exact upload session.
// A client-supplied video ID is never used to bind a job.
export async function sessionStatus(send: typeof fetch, session: string, size: number) {
  const response = await send(sessionUrl(session), {
    method: "PUT",
    redirect: "manual",
    signal: AbortSignal.timeout(15000),
    headers: { "Content-Range": `bytes */${size}` },
    body: null,
  });
  if (response.status === 200 || response.status === 201) {
    const body = await response.json();
    if (typeof body.id !== "string" || !/^[A-Za-z0-9_-]{11}$/.test(body.id)) {
      throw new ActionError("completion_uncertain", 409);
    }
    return { videoId: body.id as string, offset: size };
  }
  await response.body?.cancel();
  if (response.status !== 308) throw new ActionError("session_unavailable_no_restart", 409);
  const range = response.headers.get("Range");
  const match = range?.match(/^bytes=0-(\d+)$/);
  const offset = range === null ? 0 : match ? Number(match[1]) + 1 : NaN;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > size) {
    throw new ActionError("completion_uncertain", 409);
  }
  return { videoId: null, offset };
}
export async function providerVideo(
  send: typeof fetch,
  token: string,
  id: string,
): Promise<ProviderVideo> {
  const body = await providerJson(
    send,
    `https://www.googleapis.com/youtube/v3/videos?part=snippet,status,processingDetails,fileDetails,contentDetails&id=${id}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (body.items?.length !== 1) throw new ActionError("provider_status_unavailable", 409);
  return body.items[0];
}
