import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import {
  availableChoice,
  type QrChoice,
  type VideoItem,
  youtubeWatchDestination,
} from "./video-selection";

type Client = SupabaseClient<Database>;
type Job = Database["public"]["Tables"]["upload_jobs"]["Row"];

function uploadStatus(
  job: Pick<Job, "state" | "verified_at" | "effective_visibility" | "processing_status">,
) {
  if (job.state === "failed" || job.processing_status === "failed") return "Upload failed";
  if (job.state === "cancelled") return "Upload cancelled";
  if (job.verified_at && job.effective_visibility === "private") return "Private — QR unavailable";
  if (job.processing_status === "processing") return "Processing — QR unavailable";
  return "Awaiting verification — QR unavailable";
}

export async function loadVideoLibrary(
  client: Client,
  owner: string,
  signal: AbortSignal,
): Promise<VideoItem[]> {
  const [albums, videos, workflows, jobs, ready] = await Promise.all([
    client.from("albums").select("id,title,sort_order").eq("owner_id", owner)
      .order("sort_order").order("id").abortSignal(signal),
    client.from("videos").select("id,album_id,caption,sort_order").eq("owner_id", owner)
      .order("sort_order").order("id").abortSignal(signal),
    client.from("upload_workflows").select("id,expires_at").eq("owner_id", owner)
      .abortSignal(signal),
    client.from("upload_jobs")
      .select("id,video_id,workflow_id,state,verified_at,effective_visibility,processing_status")
      .eq("owner_id", owner).order("created_at", { ascending: false })
      .order("id", { ascending: false }).abortSignal(signal),
    client.from("qr_ready_uploads").select("id,video_id,workflow_id,effective_visibility").eq(
      "owner_id",
      owner,
    )
      .abortSignal(signal),
  ]);
  if ([albums, videos, workflows, jobs, ready].some((result) => result.error)) {
    throw new Error("Could not load videos. Try again.");
  }
  const now = Date.now();
  const deadlines = new Map(workflows.data!.map((row) => [row.id, Date.parse(row.expires_at)]));
  const eligible = new Map(ready.data!.map((row) => [row.id, row]));
  // A newer pending/failed upload must never fall back to an older ready upload for this entry.
  const latest = new Map<string, NonNullable<typeof jobs.data>[number]>();
  for (const job of jobs.data!) {
    if (!latest.has(job.video_id)) latest.set(job.video_id, job);
  }
  // Album order, then entry order, with UUID tie-breakers supplied by the queries.
  return albums.data!.flatMap((album) =>
    videos.data!.filter((video) => video.album_id === album.id).map((video) => {
      const job = latest.get(video.id);
      const expiresAt = job ? deadlines.get(job.workflow_id) ?? null : null;
      const live = expiresAt !== null && expiresAt > now;
      const verified = job && eligible.get(job.id);
      const choice = job && live && verified
        ? { videoId: video.id, jobId: job.id, workflowId: job.workflow_id }
        : null;
      return {
        id: video.id,
        caption: video.caption,
        albumTitle: album.title,
        expiresAt,
        choice,
        status: choice
          ? `Ready for QR — ${verified!.effective_visibility === "public" ? "Public" : "Unlisted"}`
          : job && live
          ? uploadStatus(job)
          : "No active upload — QR unavailable",
      };
    })
  );
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
  const current = await loadVideoLibrary(client, owner, signal);
  const { data, error } = await client.from("qr_ready_uploads")
    .select("id,video_id,workflow_id,provider_video_id").eq("owner_id", owner)
    .in("id", choices.map((choice) => choice.jobId)).abortSignal(signal);
  if (error) throw new Error("Could not verify the QR selection. Try again.");
  return choices.map((choice) => {
    const item = current.find((item) => item.id === choice.videoId);
    const live = item && availableChoice(item, Date.now());
    if (!live || live.jobId !== choice.jobId || live.workflowId !== choice.workflowId) {
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
