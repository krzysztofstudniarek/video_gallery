import { client } from "../../auth/client";
import type { ChannelQrChoice, VideoItem } from "./video-selection";
import { youtubeWatchDestination } from "./video-selection";
import type { PrintableEntry } from "../print/artifacts";

export type ChannelDestinations = {
  workflowId: string;
  expiresAt: string;
  entries: (PrintableEntry & { id: string })[];
};

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
  const page: ChannelPage = data;
  // A response can cross the fixed deadline while in flight. Never retain its titles or cursor.
  if (
    page.connected && (!page.workflowId || !page.expiresAt ||
      !Number.isFinite(Date.parse(page.expiresAt)) || Date.parse(page.expiresAt) <= Date.now() ||
      (previous &&
        (page.workflowId !== previous.workflowId || page.expiresAt !== previous.expiresAt)))
  ) {
    throw new Error("The YouTube connection expired. Refresh videos to check again.");
  }
  return page;
}

export function channelItems(page: ChannelPage): VideoItem[] {
  if (
    !page.connected || !page.workflowId || !page.expiresAt ||
    !Number.isFinite(Date.parse(page.expiresAt)) || Date.parse(page.expiresAt) <= Date.now()
  ) return [];
  const workflowId = page.workflowId;
  return page.items.map((video) => ({
    id: `channel:${workflowId}:${video.id}`,
    caption: video.title,
    albumTitle: "Existing Unlisted video on YouTube",
    status: video.processed
      ? "Unlisted — ready to verify for QR download"
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
    !workflowId || !choices.length || choices.length > 50 ||
    new Set(choices.map((choice) => choice.videoId)).size !== choices.length ||
    choices.some((choice) => choice.workflowId !== workflowId)
  ) {
    throw new Error("Select up to 50 distinct videos from one active channel connection.");
  }
  signal.throwIfAborted();
  const { data, error } = await libraryClient.functions.invoke("channel-library", {
    body: { action: "destinations", workflowId, videoIds: choices.map((choice) => choice.videoId) },
    signal,
  });
  signal.throwIfAborted();
  const result = data as ChannelDestinations | null;
  if (
    error || !result || result.workflowId !== workflowId ||
    !Number.isFinite(Date.parse(result.expiresAt)) || Date.parse(result.expiresAt) <= Date.now() ||
    !Array.isArray(result.entries) || result.entries.length !== choices.length ||
    result.entries.some((entry, index) =>
      entry.id !== choices[index].videoId || typeof entry.caption !== "string" ||
      entry.visibility !== "unlisted" || entry.qrEligible !== true ||
      youtubeWatchDestination(entry.destination) !==
        `https://www.youtube.com/watch?v=${choices[index].videoId}`
    )
  ) throw new Error("A selected YouTube video is no longer available. Refresh videos.");
  return result;
}
