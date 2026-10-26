import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import { verifyChannelSelection } from "./channel-library";
import {
  availableChoice,
  isChannelChoice,
  type QrChoice,
  type UploadedQrChoice,
  type VideoItem,
  youtubeWatchDestination,
} from "./video-selection";

type Client = SupabaseClient<Database>;
type LibraryRow = Database["public"]["Views"]["video_library"]["Row"];

function uploadStatus(job: LibraryRow) {
  if (job.job_state === "failed" || job.processing_status === "failed") return "Upload failed";
  if (job.job_state === "cancelled") return "Upload cancelled";
  if (job.verified_at && job.effective_visibility === "private") return "Private — QR unavailable";
  if (job.processing_status === "processing") return "Processing — QR unavailable";
  return "Awaiting verification — QR unavailable";
}

function toVideoItem(row: LibraryRow, now: number): VideoItem {
  if (!row.id || row.caption === null || row.album_title === null) {
    throw new Error("Could not load videos. Try again.");
  }
  // The temporary app context expires; this never expires or deletes the YouTube video.
  const expiresAt = row.workflow_expires_at ? Date.parse(row.workflow_expires_at) : null;
  const live = expiresAt !== null && expiresAt > now;
  const choice = live && row.qr_ready && row.job_id && row.workflow_id
    ? { videoId: row.id, jobId: row.job_id, workflowId: row.workflow_id }
    : null;
  return {
    id: row.id,
    caption: row.caption,
    albumTitle: row.album_title,
    expiresAt,
    choice,
    providerId: choice ? row.provider_video_id ?? undefined : undefined,
    status: choice
      ? `Ready for QR — ${row.qr_visibility === "public" ? "Public" : "Unlisted"}`
      : row.job_id && live
      ? uploadStatus(row)
      : "No active upload — QR unavailable",
  };
}

export async function loadVideoLibrary(
  client: Client,
  owner: string,
  signal: AbortSignal,
): Promise<VideoItem[]> {
  const { data, error } = await client.from("video_library").select("*").eq("owner_id", owner)
    .order("album_sort_order").order("album_id").order("video_sort_order").order("id")
    .abortSignal(signal);
  if (error) {
    throw new Error("Could not load videos. Try again.");
  }
  const now = Date.now();
  return data.map((row) => toVideoItem(row, now));
}

// #7/#15 call this at the download boundary, never trust a saved selection or cached watch URL.
// Keep returned destinations in memory only and deliver downloads before workflow cleanup.
export async function resolveQrSelection(
  client: Client,
  owner: string,
  choices: QrChoice[],
  signal: AbortSignal,
) {
  if (!choices.length) throw new Error("Select at least one ready video.");
  const channel = choices.filter(isChannelChoice);
  if (channel.length) {
    await verifyChannelSelection(client, channel, signal);
    // #7/#15 must complete the anonymous playback gate before enabling channel QR downloads.
    // Never mistake successful owner-authorized metadata reads for anonymous playback evidence.
    throw new Error(
      "Complete the anonymous playback check before downloading channel-video QR codes.",
    );
  }
  const uploads = choices.filter((choice): choice is UploadedQrChoice => !isChannelChoice(choice));
  const current = await loadVideoLibrary(client, owner, signal);
  const { data, error } = await client.from("qr_ready_uploads")
    .select("id,video_id,workflow_id,provider_video_id").eq("owner_id", owner)
    .in("id", uploads.map((choice) => choice.jobId)).abortSignal(signal);
  if (error) throw new Error("Could not verify the QR selection. Try again.");
  return uploads.map((choice) => {
    const item = current.find((item) => item.id === choice.videoId);
    const live = item && availableChoice(item, Date.now());
    if (
      !live || isChannelChoice(live) || live.jobId !== choice.jobId ||
      live.workflowId !== choice.workflowId
    ) {
      throw new Error("A selected video is no longer ready for QR codes.");
    }
    const row = data.find((candidate) =>
      candidate.id === choice.jobId && candidate.video_id === choice.videoId &&
      candidate.workflow_id === choice.workflowId
    );
    if (!row?.provider_video_id) {
      throw new Error("A selected video is no longer ready for QR codes.");
    }
    return {
      ...choice,
      destination: youtubeWatchDestination(
        `https://www.youtube.com/watch?v=${row.provider_video_id}`,
      ),
    };
  });
}
