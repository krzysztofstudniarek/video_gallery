import {
  availableChoice,
  selectedChoices,
  type VideoItem,
  youtubeWatchDestination,
} from "../frontend/video-selection.ts";

function assert(value: unknown): asserts value {
  if (!value) throw new Error("Assertion failed");
}

Deno.test("QR selection drops missing, blocked and expired entries and follows display order", () => {
  const ready: VideoItem = {
    id: "ready",
    caption: "Synthetic fixture",
    albumTitle: "Synthetic album",
    status: "Ready for QR",
    expiresAt: 200,
    choice: { videoId: "ready", jobId: "job", workflowId: "workflow" },
  };
  const blocked = { ...ready, id: "blocked", choice: null };
  const expired = { ...ready, id: "expired", expiresAt: 100 };
  const second = {
    ...ready,
    id: "second",
    choice: { videoId: "second", jobId: "second-job", workflowId: "workflow" },
  };
  const choices = selectedChoices(
    [ready, blocked, expired, second],
    ["second", "expired", "missing", "blocked", "ready"],
    100,
  );
  assert(choices.length === 2 && choices[0].videoId === "ready" && choices[1].videoId === "second");
  assert(availableChoice(ready, 199) !== null);
  assert(availableChoice(ready, 200) === null);
  assert(selectedChoices([ready], ["ready"], 200).length === 0);
});

Deno.test("only canonical direct YouTube watch destinations can reach the QR handoff", () => {
  const safe = "https://www.youtube.com/watch?v=synthetic01";
  assert(youtubeWatchDestination(safe) === safe);
  for (
    const input of [
      "http://www.youtube.com/watch?v=synthetic01",
      "https://www.youtube.com.evil.test/watch?v=synthetic01",
      "https://www.youtube.com@evil.test/watch?v=synthetic01",
      "https://evil.test@www.youtube.com/watch?v=synthetic01",
      "https://www.youtube.com:444/watch?v=synthetic01",
      "https://youtu.be/synthetic01",
      "https://vimeo.com/12345678901",
      "javascript:alert(1)",
      "https://www.youtube.com/watch?v=short",
      "https://www.youtube.com/watch?v=synthetic01&v=synthetic02",
      "https://www.youtube.com/watch?v=synthetic01&next=https://evil.test",
      "https://www.youtube.com/watch?v=synthetic01#fragment",
      "https://www.youtube.com/watch?v=synthetic%31",
      " https://www.youtube.com/watch?v=synthetic01",
      "https://www.youtube.com/watch?v=synthetic01\n",
    ]
  ) {
    let rejected = false;
    try {
      youtubeWatchDestination(input);
    } catch {
      rejected = true;
    }
    assert(rejected);
  }
});
