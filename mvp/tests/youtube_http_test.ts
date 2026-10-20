import { youtubeHandler } from "../supabase/functions/_shared/youtube-handler.ts";
import { ActionError, safeError } from "../supabase/functions/_shared/youtube/errors.ts";
import { MAX_REQUEST_BYTES, readJson } from "../supabase/functions/_shared/youtube/http.ts";
import { parseAction } from "../supabase/functions/_shared/youtube/inputs.ts";

function assert(value: unknown): asserts value {
  if (!value) throw new Error("Assertion failed");
}
async function expectError(call: () => Promise<unknown>, status: number) {
  try {
    await call();
  } catch (error) {
    assert(error instanceof ActionError && error.status === status);
    return;
  }
  throw new Error("Expected request rejection");
}
const base: Record<string, string> = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_ANON_KEY: "synthetic",
  SUPABASE_SERVICE_ROLE_KEY: "synthetic-admin",
};
Deno.test("handler rejects missing or invalid origin at startup without making requests", () => {
  for (const origin of [undefined, "", "https://example.test/path", "http://example.test", "*"]) {
    let rejected = false;
    try {
      youtubeHandler((name) => name === "FRONTEND_ORIGIN" ? origin : base[name], () => {
        throw new Error("Network must not be called");
      });
    } catch (error) {
      rejected = error instanceof Error && error.message.includes("FRONTEND_ORIGIN");
    }
    assert(rejected);
  }
});
Deno.test("local development works with an explicitly configured origin", async () => {
  const handler = youtubeHandler((name) =>
    name === "FRONTEND_ORIGIN" ? "http://127.0.0.1:5173" : base[name]
  );
  const response = await handler(
    new Request("http://localhost", {
      method: "OPTIONS",
      headers: { Origin: "http://127.0.0.1:5173" },
    }),
  );
  assert(response.status === 200);
  assert(response.headers.get("Access-Control-Allow-Origin") === "http://127.0.0.1:5173");
});
Deno.test("JSON request at byte limit is accepted; UTF-8 bytes count rather than characters", async () => {
  const exact = '"' + "a".repeat(MAX_REQUEST_BYTES - 2) + '"';
  assert(
    (await readJson(new Request("https://example.test", { method: "POST", body: exact })) as string)
      .length === MAX_REQUEST_BYTES - 2,
  );
  const multibyte = JSON.stringify({ value: "é".repeat(MAX_REQUEST_BYTES / 2) });
  assert(multibyte.length < MAX_REQUEST_BYTES);
  await expectError(
    () => readJson(new Request("https://example.test", { method: "POST", body: multibyte })),
    413,
  );
});
Deno.test("chunked body over limit is cancelled without reading the rest", async () => {
  let cancelled = false, pulls = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls++;
      controller.enqueue(new Uint8Array(1024));
    },
    cancel() {
      cancelled = true;
    },
  }, { highWaterMark: 0 });
  await expectError(
    () => readJson(new Request("https://example.test", { method: "POST", body: stream })),
    413,
  );
  assert(cancelled && pulls === MAX_REQUEST_BYTES / 1024 + 1);
});
Deno.test("declared oversized body is cancelled before reading", async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    cancel() {
      cancelled = true;
    },
  });
  await expectError(() =>
    readJson(
      new Request("https://example.test", {
        method: "POST",
        headers: { "Content-Length": String(MAX_REQUEST_BYTES + 1) },
        body: stream,
      }),
    ), 413);
  assert(cancelled);
});
Deno.test("invalid JSON and arrays are rejected without reflecting request content", async () => {
  await expectError(
    () =>
      readJson(
        new Request("https://example.test", { method: "POST", body: "sensitive-invalid-json" }),
      ),
    400,
  );
  try {
    parseAction([]);
    throw new Error("Expected rejection");
  } catch (error) {
    assert(error instanceof ActionError);
  }
  assert(!JSON.stringify(safeError(new Error("sensitive-provider-detail"))).includes("sensitive"));
});
Deno.test("action validation discards caller identity and rejects invalid actions", () => {
  const input = parseAction({ action: "status", owner_id: "another-owner" });
  assert(!("owner_id" in input));
  try {
    parseAction({ action: "unknown" });
    throw new Error("Expected rejection");
  } catch (error) {
    assert(error instanceof ActionError && error.code === "invalid_action");
  }
});
