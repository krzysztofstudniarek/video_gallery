import { test } from "node:test";
import assert from "node:assert/strict";
import { browserPolicy } from "./browser-policy.mjs";

test("production policy confines scripts and connections without inline execution or dev sockets", () => {
  const policy = browserPolicy("https://project.supabase.co");
  assert.ok(policy.includes("script-src 'self'"));
  assert.ok(
    policy.includes("connect-src 'self' https://project.supabase.co https://www.googleapis.com"),
  );
  assert.ok(!/unsafe-|\*|ws:/.test(policy));
  for (
    const url of [
      "https://user:secret@example.test",
      "http://example.test",
      "https://example.test/?x=1",
    ]
  ) {
    assert.throws(() => browserPolicy(url));
  }
});
