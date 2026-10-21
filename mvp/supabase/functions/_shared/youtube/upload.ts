import { type Context, requireConnection } from "./context.ts";
import { refreshAccess } from "./connection.ts";
import { ActionError } from "./errors.ts";
import { sessionUrl } from "./google.ts";
import type { InitiateInput, ResumeInput, VerifyInput } from "./inputs.ts";

export async function initiateUpload(context: Context, input: InitiateInput) {
  const row = await requireConnection(context);
  if (input.channel_id !== row.channel_id) {
    throw new ActionError("invalid_upload_confirmation", 400);
  }
  if (await context.repository.job()) throw new ActionError("existing_probe_resume_or_clear", 409);
  const { accessToken } = await refreshAccess(context);
  const job = crypto.randomUUID();
  // Retain the reservation after ambiguous provider errors; do not initiate twice.
  await context.repository.reserve(job, input.size, input.sha256);
  const session = await context.google.initiate(accessToken, job, input.size, input.made_for_kids);
  await context.repository.saveSession(job, await context.cipher.seal(`upload:${job}`, session));
  return { job_id: job, session_url: session };
}
async function requireJob(context: Context) {
  await requireConnection(context);
  const job = await context.repository.job();
  if (!job?.session_cipher) throw new ActionError("no_resumable_probe", 409);
  return { ...job, session_cipher: job.session_cipher };
}
export async function resumeUpload(context: Context, input: ResumeInput) {
  const job = await requireJob(context);
  if (input.size !== Number(job.size_bytes) || input.sha256 !== job.file_sha256) {
    throw new ActionError("choose_original_file", 400);
  }
  await refreshAccess(context);
  return {
    job_id: job.job_id,
    session_url: sessionUrl(
      await context.cipher.unseal(`upload:${job.job_id}`, job.session_cipher),
    ),
  };
}
export async function verifyUpload(context: Context, input: VerifyInput) {
  const job = await requireJob(context);
  const { row, accessToken } = await refreshAccess(context);
  const video = await context.google.video(accessToken, input.video_id);
  if (
    !video || video.snippet.channelId !== row.channel_id ||
    video.snippet.description !== `VideoAlbum probe ${job.job_id}`
  ) throw new ActionError("video_not_this_probe", 403);
  const privacy = video.status.privacyStatus;
  const processing = video.processingDetails?.processingStatus ?? video.status.uploadStatus;
  if (
    ["failed", "terminated", "rejected", "deleted"].includes(processing) ||
    ["failed", "rejected", "deleted"].includes(video.status.uploadStatus)
  ) throw new ActionError("upload_processing_failed", 409);
  if (privacy !== "unlisted") {
    throw new ActionError("visibility_not_unlisted", 409, { privacy, processing });
  }
  return {
    privacy,
    processing,
    verified_unlisted: true,
    ready: processing === "succeeded" || video.status.uploadStatus === "processed",
  };
}
export async function clearUpload(context: Context) {
  await requireConnection(context);
  await context.repository.clearJob();
  return { cleared: true };
}
export async function inspectUpload(context: Context) {
  const job = await requireJob(context);
  const session = await context.cipher.unseal(`upload:${job.job_id}`, job.session_cipher);
  // Only OPTIONS and an empty status PUT; never send/retry media or create a session.
  return context.google.inspectSession(session, Number(job.size_bytes));
}
