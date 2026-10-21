import { ActionError } from "./errors.ts";

// Only OAuth/action metadata belongs here. Media goes directly to Google.
export const MAX_REQUEST_BYTES = 8 * 1024;
export function corsHeaders(origin: string) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "Vary": "Origin",
  };
}
export async function readJson(request: Request): Promise<unknown> {
  const declared = request.headers.get("Content-Length");
  if (declared !== null && Number(declared) > MAX_REQUEST_BYTES) {
    await request.body?.cancel();
    throw new ActionError("request_too_large", 413);
  }
  const reader = request.body?.getReader();
  if (!reader) throw new ActionError("invalid_request", 400);
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_REQUEST_BYTES) {
        await reader.cancel();
        throw new ActionError("request_too_large", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const buffer = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer));
  } catch {
    throw new ActionError("invalid_request", 400);
  }
}
