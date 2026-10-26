// Selection contains app identifiers only. Resolve destinations again immediately before export.
export type QrChoice = { videoId: string; jobId: string; workflowId: string };
export type VideoItem = {
  id: string;
  caption: string;
  albumTitle: string;
  status: string;
  expiresAt: number | null;
  choice: QrChoice | null;
};

export function availableChoice(item: VideoItem, now: number): QrChoice | null {
  return item.expiresAt !== null && item.expiresAt > now ? item.choice : null;
}

export function selectedChoices(items: VideoItem[], selected: string[], now: number): QrChoice[] {
  return items.flatMap((item) => {
    const choice = availableChoice(item, now);
    return choice && selected.includes(item.id) ? [choice] : [];
  });
}

// Deliberately accept only canonical HTTPS watch destinations, with one validated video ID.
// There is no pasted-link UI; the export handoff uses IDs read from qr_ready_uploads.
export function youtubeWatchDestination(input: string): string {
  if (
    input.trim() !== input ||
    !/^https:\/\/www\.youtube\.com\/watch\?v=[A-Za-z0-9_-]{11}$/.test(input)
  ) {
    throw new Error("Invalid YouTube watch destination");
  }
  return input;
}
