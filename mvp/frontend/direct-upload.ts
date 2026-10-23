// The browser sends media only to Google's resumable session, never to Supabase.
export type UploadReply = { status: number; range: string | null; body: string };
export type Transport = (
  url: string,
  body: Blob | null,
  range: string,
  progress: (bytes: number) => void,
  signal?: AbortSignal,
) => Promise<UploadReply>;
export const xhrTransport: Transport = (url, body, range, progress, signal) =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const abort = () => {
      xhr.abort();
      reject(new DOMException("Transfer stopped", "AbortError"));
    };
    if (signal?.aborted) return abort();
    signal?.addEventListener("abort", abort, { once: true });
    xhr.onloadend = () => signal?.removeEventListener("abort", abort);
    xhr.open("PUT", url);
    xhr.timeout = 60000;
    xhr.setRequestHeader("Content-Range", range);
    if (body) xhr.setRequestHeader("Content-Type", "video/mp4");
    xhr.upload.onprogress = (event) => progress(event.loaded);
    xhr.onload = () =>
      resolve({
        status: xhr.status,
        range: xhr.getResponseHeader("Range"),
        body: xhr.responseText,
      });
    xhr.onerror = () =>
      reject(
        new Error(
          "Browser transfer failed. Check network/CORS; resume the existing probe instead of starting another.",
        ),
      );
    xhr.ontimeout = () => reject(new Error("Transfer timed out. Resume the existing probe."));
    xhr.send(body);
  });
export function acknowledged(range: string | null, total: number) {
  if (!range) return 0;
  const match = /^bytes=0-(\d+)$/.exec(range);
  const offset = match ? Number(match[1]) + 1 : NaN;
  if (!Number.isSafeInteger(offset) || offset <= 0 || offset > total) {
    throw new Error("Invalid upload offset");
  }
  return offset;
}
function videoId(reply: UploadReply) {
  const value = JSON.parse(reply.body).id;
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{11}$/.test(value)) {
    throw new Error("Upload response has no valid video ID");
  }
  return value;
}
export async function directUpload(
  url: string,
  file: Blob,
  progress: (bytes: number) => void,
  paused: () => boolean,
  send: Transport = xhrTransport,
  signal?: AbortSignal,
): Promise<string | null> {
  signal?.throwIfAborted();
  const target = new URL(url);
  if (
    target.protocol !== "https:" || target.hostname !== "www.googleapis.com" || target.username ||
    target.password || target.port || !target.pathname.startsWith("/upload/youtube/v3/videos")
  ) throw new Error("Invalid upload destination");
  const status = await send(url, null, `bytes */${file.size}`, () => {}, signal);
  signal?.throwIfAborted();
  if (status.status === 200 || status.status === 201) return videoId(status);
  if (status.status !== 308) {
    throw new Error(
      "Session unavailable. Keep this probe and check its status before clearing it.",
    );
  }
  let offset = acknowledged(status.range, file.size);
  const chunkSize = 256 * 1024;
  while (offset < file.size) {
    if (paused()) return null;
    const end = Math.min(offset + chunkSize, file.size);
    const reply = await send(
      url,
      file.slice(offset, end, "video/mp4"),
      `bytes ${offset}-${end - 1}/${file.size}`,
      (bytes) => progress(Math.min(offset + bytes, file.size)),
      signal,
    );
    signal?.throwIfAborted();
    if (reply.status === 200 || reply.status === 201) {
      progress(file.size);
      return videoId(reply);
    }
    if (reply.status !== 308) {
      throw new Error(
        "YouTube rejected the chunk. Resume this probe to query the accepted offset.",
      );
    }
    if (!reply.range) {
      throw new Error(
        "Upload Range is not exposed to this browser. Direct-upload feasibility is blocked; do not start another upload.",
      );
    }
    const accepted = acknowledged(reply.range, file.size);
    if (accepted <= offset || accepted > end) throw new Error("Unexpected upload offset");
    offset = accepted;
    progress(offset);
  }
  throw new Error("Upload completion is not confirmed; resume to query status.");
}
