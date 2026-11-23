import { ActionError } from "./youtube/errors.ts";

export const uploadLimits = { bytes: 1073741824, seconds: 600, polls: 120 } as const;
export const isUuid = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);
export type UploadRequest = {
  workflowId: string;
  key: string;
  title: string;
  description: string;
  caption: string;
  visibility: "private" | "unlisted" | "public";
  confirmPublic: boolean;
  size: number;
  sha256: string;
  madeForKids: boolean;
};
export function uploadRequest(body: Record<string, unknown>): UploadRequest {
  if (
    !isUuid(body.workflowId) || !isUuid(body.key) ||
    typeof body.title !== "string" || !body.title.trim() || [...body.title].length > 100 ||
    /[<>]/.test(body.title) || typeof body.description !== "string" ||
    new TextEncoder().encode(body.description).length > 5000 || /[<>]/.test(body.description) ||
    typeof body.caption !== "string" || [...body.caption].length > 2000 ||
    !["private", "unlisted", "public"].includes(String(body.visibility)) ||
    typeof body.confirmPublic !== "boolean" ||
    (body.visibility === "public" && !body.confirmPublic) ||
    typeof body.size !== "number" || !Number.isSafeInteger(body.size) ||
    body.size < 1 || body.size > uploadLimits.bytes ||
    typeof body.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(body.sha256) ||
    typeof body.madeForKids !== "boolean"
  ) throw new ActionError("invalid_upload_request", 400);
  return body as unknown as UploadRequest;
}
export function uploadMetadata(input: {
  upload_title: string;
  upload_description: string;
  requested_visibility: string;
  public_confirmed_at: string | null;
}, kids: boolean) {
  if (input.requested_visibility === "public" && !input.public_confirmed_at) {
    throw new ActionError("public_confirmation_required", 409);
  }
  return {
    snippet: { title: input.upload_title, description: input.upload_description, categoryId: "22" },
    status: { privacyStatus: input.requested_visibility, selfDeclaredMadeForKids: kids },
  };
}
export type ProviderVideo = {
  id?: string;
  snippet?: { channelId?: string };
  status?: { privacyStatus?: string; uploadStatus?: string };
  processingDetails?: { processingStatus?: string };
  fileDetails?: { fileSize?: string };
  contentDetails?: { duration?: string };
};
export function durationSeconds(value: string | undefined) {
  const match = value?.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/);
  return match && match.slice(1).some((part) => part !== undefined)
    ? Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0)
    : null;
}
export function verifyProviderVideo(
  video: ProviderVideo,
  id: string,
  channel: string,
  requested: string,
  limits: { bytes: number; seconds: number } = uploadLimits,
) {
  if (video.id !== id || video.snippet?.channelId !== channel) {
    throw new ActionError("video_ownership_mismatch", 403);
  }
  const visibility = video.status?.privacyStatus;
  if (!visibility || !["private", "unlisted", "public"].includes(visibility)) {
    throw new ActionError("provider_status_unavailable", 502);
  }
  const status = video.processingDetails?.processingStatus;
  const upload = video.status?.uploadStatus;
  const processing = ["failed", "terminated", "rejected", "deleted"].includes(status ?? "") ||
      ["failed", "rejected", "deleted"].includes(upload ?? "")
    ? "failed"
    : status === "succeeded" && upload === "processed"
    ? "succeeded"
    : "processing";
  const size = Number(video.fileDetails?.fileSize);
  const duration = durationSeconds(video.contentDetails?.duration);
  const sizeBytes = Number.isSafeInteger(size) && size > 0 ? size : null;
  const seconds = duration !== null && Number.isFinite(duration) && duration > 0 ? duration : null;
  const failure = visibility !== requested
    ? "visibility_mismatch"
    : processing === "failed"
    ? "processing_failed"
    : (sizeBytes !== null && sizeBytes > limits.bytes) ||
        (seconds !== null && seconds > limits.seconds)
    ? "provider_media_limit"
    : null;
  return { visibility, processing, sizeBytes, seconds, failure };
}
