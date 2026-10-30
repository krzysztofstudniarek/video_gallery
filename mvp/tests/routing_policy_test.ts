import {
  consumeReturn,
  parseCallback,
  rememberReturn,
  returnKey,
  safePath,
} from "../frontend/routing-policy.ts";
function assert(value: unknown) {
  if (!value) throw new Error("Routing policy assertion failed");
}
function storage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
    key: (index) => [...values.keys()][index] ?? null,
  };
}
Deno.test("only existing internal screens can be retained as login return targets", () => {
  for (const path of ["/", "/videos", "/account", "/tools"]) assert(safePath(path) === path);
  for (
    const path of [
      "//evil.test",
      "https://evil.test",
      "/account?code=secret",
      "/tools#secret",
      "/%2fexample.test",
      "/videos/../account",
      "\\\\evil.test",
      "/unknown",
      null,
    ]
  ) assert(safePath(path) === null);
});
Deno.test("return targets expire, are flow/owner-bound and are consumed only once", () => {
  const store = storage();
  rememberReturn(store, "auth", "/account");
  assert(consumeReturn(store, "auth") === "/account");
  assert(consumeReturn(store, "auth") === null);
  rememberReturn(store, "youtube", "/tools", "owner-a");
  assert(consumeReturn(store, "youtube", "owner-b") === null);
  assert(store.length === 0);
  rememberReturn(store, "youtube", "/tools", "owner-a");
  assert(consumeReturn(store, "auth", "owner-a") === null);
  for (const created of [Date.now() - 600001, Date.now() + 600001, "invalid"]) {
    store.setItem(returnKey, JSON.stringify({ flow: "auth", path: "/account", created }));
    assert(consumeReturn(store, "auth") === null);
  }
  store.setItem(returnKey, "invalid json");
  assert(consumeReturn(store, "auth") === null);
  assert(store.length === 0);
});
Deno.test("OAuth parsing isolates flows and rejects ambiguous, misplaced and implicit callbacks", () => {
  const read = (path: string) => parseCallback(new URL(path, "https://example.test"), "/");
  assert(read("/?code=one").code === "one");
  assert(read("/?youtube_callback=1&code=one&state=state").flow === "youtube");
  for (
    const path of [
      "/?code=one&code=two",
      "/?code=one&error=denied",
      "/?youtube_callback=1&code=one",
      "/?youtube_callback=0&code=one&state=x",
      "/?youtube_callback=1&state=x&state=y&code=z",
      "/?state=x",
      "/videos?code=x",
      "/#access_token=x",
      "/?code=",
    ]
  ) assert(read(path).invalid);
  assert(read("/?youtube_callback=1&error=access_denied&state=x").denied);
  assert(!read("/?youtube_callback=1&error=access_denied&state=x").invalid);
  assert(read("/?tools=1").tools);
  assert(!read("/?tools=1&tools=1").tools);
  assert(
    parseCallback(new URL("https://example.test/video_gallery/?code=x"), "/video_gallery/").code ===
      "x",
  );
});
