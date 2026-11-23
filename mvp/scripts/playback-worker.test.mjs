import { test } from "node:test";
import assert from "node:assert/strict";
import { checkAnonymousPlayback, runPlaybackWorker } from "./playback-worker.mjs";
function backend(count = 1) {
  const calls = [];
  let remaining = count;
  const client = {
    rpc: async (name, args) => {
      calls.push({ name, args });
      if (name === "claim_upload_playback") {
        return {
          data: remaining-- > 0
            ? { jobId: "synthetic-job", ownerId: "synthetic-owner", videoId: "synthetic61" }
            : null,
          error: null,
        };
      }
      return { data: true, error: null };
    },
  };
  return { client, calls };
}
test("trusted playback worker is bounded and commits only its claimed boolean result", async () => {
  const b = backend(20), seen = [];
  const result = await runPlaybackWorker({
    client: b.client,
    browser: {},
    origin: "https://example.test",
    limit: 2,
    check: async (_browser, _origin, id) => {
      seen.push(id);
      return true;
    },
  });
  assert.equal(result.checked, 2);
  assert.equal(result.passed, 2);
  assert.equal(seen.length, 2);
  const claims = b.calls.filter((c) => c.name === "claim_upload_playback");
  const results = b.calls.filter((c) => c.name === "finish_upload_playback");
  assert.equal(results[0].args.p_claim, claims[0].args.p_claim);
  assert.equal(results[0].args.p_passed, true);
  assert.deepEqual(Object.keys(results[0].args).sort(), ["p_claim", "p_passed"]);
});
test("player failures fail closed and late/disconnected results are discarded", async () => {
  const b = backend();
  const result = await runPlaybackWorker({
    client: b.client,
    browser: {},
    origin: "https://example.test",
    check: async () => {
      throw new Error("sensitive provider challenge");
    },
  });
  assert.equal(result.failed, 1);
  assert.equal(b.calls[1].args.p_passed, false);
  const c = backend();
  const call = c.client.rpc;
  c.client.rpc = async (name, args) =>
    name === "finish_upload_playback" ? { data: false, error: null } : call(name, args);
  const discarded = await runPlaybackWorker({
    client: c.client,
    browser: {},
    origin: "https://example.test",
    check: async () => true,
  });
  assert.equal(discarded.discarded, 1);
  assert.equal(discarded.passed, 0);
});
test("worker rejects malformed bounds and never opens a browser for invalid IDs", async () => {
  for (const limit of [0, 11, 1.5]) {
    await assert.rejects(() =>
      runPlaybackWorker({ client: {}, browser: {}, origin: "https://example.test", limit })
    );
  }
  assert.equal(await checkAnonymousPlayback({}, "https://example.test", "invalid"), false);
});
