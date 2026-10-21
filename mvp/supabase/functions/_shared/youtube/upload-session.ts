import { sessionUrl } from "./google.ts";

export async function inspectSession(
  send: typeof fetch,
  redirect: string,
  session: string,
  size: number,
) {
  const url = sessionUrl(session), origin = new URL(redirect).origin;
  const options = { redirect: "manual" as const, signal: AbortSignal.timeout(15000) };
  const preflight = await send(url, {
    ...options,
    method: "OPTIONS",
    headers: {
      Origin: origin,
      "Access-Control-Request-Method": "PUT",
      "Access-Control-Request-Headers": "content-range,content-type",
    },
  });
  const response = await send(url, {
    ...options,
    method: "PUT",
    headers: {
      Origin: origin,
      "Content-Range": `bytes */${size}`,
    },
    body: null,
  });
  const allowed = (headers: Headers) =>
    [origin, "*"].includes(headers.get("Access-Control-Allow-Origin") ?? "");
  const list = (headers: Headers, name: string) =>
    (headers.get(name) ?? "").toLowerCase().split(",").map((x) => x.trim());
  const requestHeaders = list(preflight.headers, "Access-Control-Allow-Headers");
  const exposed = list(response.headers, "Access-Control-Expose-Headers");
  const range = response.headers.get("Range")?.match(/^bytes=0-(\d+)$/);
  let videoId: string | undefined;
  if (response.status === 200 || response.status === 201) {
    try {
      const body = await response.json();
      if (typeof body.id === "string" && /^[A-Za-z0-9_-]{11}$/.test(body.id)) videoId = body.id;
    } catch { /* Report status without reflecting an untrusted provider body. */ }
  } else await response.body?.cancel();
  await preflight.body?.cancel();
  const offset = range ? Number(range[1]) + 1 : 0;
  return {
    session_status: response.status,
    complete: !!videoId,
    video_id: videoId,
    accepted_bytes: videoId
      ? size
      : response.status === 308 && Number.isSafeInteger(offset) && offset >= 0 && offset <= size
      ? offset
      : null,
    cors: {
      preflight_status: preflight.status,
      preflight_origin_allowed: allowed(preflight.headers),
      put_allowed: list(preflight.headers, "Access-Control-Allow-Methods").some((x) =>
        x === "put" || x === "*"
      ),
      headers_allowed: requestHeaders.includes("*") ||
        ["content-range", "content-type"].every((x) => requestHeaders.includes(x)),
      response_origin_allowed: allowed(response.headers),
      range_exposed: exposed.includes("range") || exposed.includes("*"),
    },
  };
}
