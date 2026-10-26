import { ActionError } from "./youtube/errors.ts";
import { googleJson } from "./youtube/google.ts";

const videoIdPattern = /^[A-Za-z0-9_-]{11}$/;
export type ChannelVideo = { id: string; title: string; processed: boolean };

export function validVideoId(value: unknown): value is string {
  return typeof value === "string" && value.length === 11 && videoIdPattern.test(value);
}

// Request only the selected channel's uploads, then confirm visibility/ownership using videos.list.
// Playlist item privacy and titles alone are never evidence of eligibility.
export class ChannelLibrary {
  constructor(private token: string, private channelId: string, private send: typeof fetch) {}

  private get(resource: string, values: Record<string, string>) {
    const url = new URL(`https://www.googleapis.com/youtube/v3/${resource}`);
    url.search = new URLSearchParams(values).toString();
    return googleJson(this.send, url.href, { headers: { Authorization: `Bearer ${this.token}` } });
  }

  async confirmChannel() {
    const result = await this.get("channels", {
      part: "contentDetails",
      mine: "true",
      fields: "items(id,contentDetails/relatedPlaylists/uploads)",
    });
    const channel = result.items?.[0];
    if (result.items?.length !== 1 || channel?.id !== this.channelId) {
      throw new ActionError("channel_changed", 409);
    }
    const playlist = channel.contentDetails?.relatedPlaylists?.uploads;
    if (typeof playlist !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(playlist)) {
      throw new ActionError("channel_library_unavailable", 502);
    }
    return playlist;
  }

  async videos(ids: string[]): Promise<ChannelVideo[]> {
    if (!ids.length) return [];
    const result = await this.get("videos", {
      part: "snippet,status,processingDetails",
      id: ids.join(","),
      fields:
        "items(id,snippet(channelId,title),status(privacyStatus,uploadStatus),processingDetails/processingStatus)",
    });
    if (!Array.isArray(result.items)) throw new ActionError("channel_library_unavailable", 502);
    const rows = new Map<string, ChannelVideo>();
    for (const item of result.items) {
      if (
        !validVideoId(item.id) || !ids.includes(item.id) ||
        item.snippet?.channelId !== this.channelId || item.status?.privacyStatus !== "unlisted"
      ) continue;
      if (typeof item.snippet.title !== "string" || item.snippet.title.length > 200) continue;
      if (
        !["uploaded", "processed"].includes(item.status.uploadStatus) ||
        ["failed", "terminated"].includes(item.processingDetails?.processingStatus)
      ) continue;
      rows.set(item.id, {
        id: item.id,
        title: item.snippet.title,
        processed: item.status.uploadStatus === "processed" &&
          item.processingDetails?.processingStatus === "succeeded",
      });
    }
    return ids.flatMap((id) => rows.has(id) ? [rows.get(id)!] : []);
  }

  async page(pageToken?: string) {
    const playlist = await this.confirmChannel();
    const result = await this.get("playlistItems", {
      part: "contentDetails",
      playlistId: playlist,
      maxResults: "50",
      fields: "nextPageToken,items/contentDetails/videoId",
      ...(pageToken ? { pageToken } : {}),
    });
    if (!Array.isArray(result.items)) throw new ActionError("channel_library_unavailable", 502);
    const ids = [
      ...new Set<string>(
        result.items.map((row: { contentDetails?: { videoId?: unknown } }) =>
          row.contentDetails?.videoId
        ).filter(validVideoId),
      ),
    ];
    if (ids.length > 50) throw new ActionError("channel_library_unavailable", 502);
    const next = result.nextPageToken;
    if (next !== undefined && (typeof next !== "string" || next.length > 512)) {
      throw new ActionError("channel_library_unavailable", 502);
    }
    return { items: await this.videos(ids), nextPageToken: next || null };
  }

  async verify(ids: string[]) {
    await this.confirmChannel();
    const items = await this.videos(ids);
    if (items.length !== ids.length || items.some((item) => !item.processed)) {
      throw new ActionError("channel_selection_changed", 409);
    }
    // Metadata eligibility is distinct from the anonymous playback check owned by #7/#15.
    return { items, requiresAnonymousPlaybackCheck: true as const };
  }
}
