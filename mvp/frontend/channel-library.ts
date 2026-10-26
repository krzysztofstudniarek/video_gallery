import { client } from "./client";
import type { ChannelQrChoice, VideoItem } from "./video-selection";

export type ChannelPage = {
  connected: boolean;
  workflowId?: string;
  expiresAt?: string;
  items: { id: string; title: string; processed: boolean }[];
  nextPageToken: string | null;
};

export async function loadChannelPage(
  signal: AbortSignal,
  previous?: ChannelPage,
): Promise<ChannelPage> {
  const { data, error } = await client.functions.invoke("channel-library", {
    body: {
      action: "list",
      ...(previous
        ? {
          workflowId: previous.workflowId,
          pageToken: previous.nextPageToken,
        }
        : {}),
    },
    signal,
  });
  if (error) throw new Error("Could not load existing YouTube videos. Refresh to try again.");
  return data;
}

export function channelItems(page: ChannelPage): VideoItem[] {
  if (
    !page.connected || !page.workflowId || !page.expiresAt ||
    Date.parse(page.expiresAt) <= Date.now()
  ) return [];
  const workflowId = page.workflowId;
  return page.items.map((video) => ({
    id: `channel:${workflowId}:${video.id}`,
    caption: video.title,
    albumTitle: "Existing Unlisted video on YouTube",
    status: video.processed
      ? "Unlisted — playback check required before QR download"
      : "Processing — QR unavailable",
    expiresAt: Date.parse(page.expiresAt!),
    source: "channel",
    providerId: video.id,
    choice: video.processed ? { source: "channel", videoId: video.id, workflowId } : null,
  }));
}

export async function verifyChannelSelection(
  libraryClient: typeof client,
  choices: ChannelQrChoice[],
  signal: AbortSignal,
) {
  const workflowId = choices[0]?.workflowId;
  if (
    !workflowId || choices.some((choice) => choice.workflowId !== workflowId)
  ) {
    throw new Error("Select videos from one active channel connection.");
  }
  const batches = [];
  for (let index = 0; index < choices.length; index += 50) {
    const { data, error } = await libraryClient.functions.invoke("channel-library", {
      body: {
        action: "verify",
        workflowId,
        videoIds: choices.slice(index, index + 50).map((choice) => choice.videoId),
      },
      signal,
    });
    if (error) throw new Error("A selected YouTube video is no longer available. Refresh videos.");
    batches.push(data);
  }
  return { batches, requiresAnonymousPlaybackCheck: true as const };
}
