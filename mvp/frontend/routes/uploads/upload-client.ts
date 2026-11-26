import { client } from "../../auth/client";

export type UploadStatus = {
  jobId: string;
  workflowId: string;
  expiresAt: string | null;
  state: string;
  requestedVisibility: string;
  effectiveVisibility: string | null;
  failure: string | null;
  pollCount: number;
  qrEligible: boolean;
};
const notices: Record<string, string> = {
  verification_required:
    "Verify every upload's processing and visibility before preparing files. Private uploads need successful processing but never generate QR codes.",
  download_batch_expired:
    "The download batch expired or its entries changed. Verify and prepare a new batch.",
  downloads_required_or_changed:
    "Save all offered downloads and confirm before finishing. If entries changed, prepare new files.",
  account_daily_quota:
    "Your daily upload allowance is used. Try again after midnight Pacific time.",
  project_daily_quota:
    "The pilot's daily upload allowance is used. Try again after midnight Pacific time.",
  youtube_quota_exceeded:
    "YouTube's upload quota is used. Wait for its quota reset; check this job before starting another.",
  waiting_turn: "Another account is ahead in the upload queue. Retry this job shortly.",
  account_transfer_busy:
    "Another upload is active on your account. Pause it and wait up to 90 seconds before resuming here.",
  project_transfer_busy: "All three pilot transfer slots are busy. Retry this job shortly.",
  transfer_busy_or_expired:
    "Transfer permission expired or another tab is using it. Pause other tabs, wait 90 seconds, then resume this job.",
  choose_original_file: "Choose the original file used to create this job.",
  workflow_unavailable:
    "This upload is unavailable, expired or disconnected. Its bookmark cannot recreate it.",
  initiation_uncertain_no_restart:
    "YouTube initiation could not be confirmed. Do not start a replacement upload. Check your channel; this job cannot safely create another session.",
  initiation_uncertain_reconcile:
    "YouTube initiation could not be confirmed. Check this same job; do not start a replacement upload.",
  reconcile_existing_job:
    "This job has already started. Check its status or resume it; do not start another upload.",
  session_unavailable_no_restart:
    "The YouTube session is unavailable. Check your channel for a completed video; this job will not start another upload.",
  poll_budget_or_cooldown:
    "Wait at least five seconds before checking again. Each job permits at most 120 checks; contact support if processing stays unresolved.",
  reconnect_youtube:
    "YouTube authorization expired or was revoked. Reconnect from Account. Existing YouTube videos remain there.",
  batch_capacity:
    "This workflow already has ten upload jobs. Finish your downloads before beginning new work.",
  video_capacity: "Your account or album has reached its video capacity (200/account, 50/album).",
  idempotency_conflict:
    "This upload request was already saved with different details. Recover its existing job before continuing.",
  idempotency_already_finished:
    "This request was already cancelled or completed. It cannot recreate purged work.",
};
export async function uploadCall<T = UploadStatus>(
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  signal?.throwIfAborted();
  const { data, error } = await client.functions.invoke("uploads", { body, signal });
  signal?.throwIfAborted();
  if (error) {
    let code = "";
    try {
      code = (await error.context?.json())?.error ?? "";
    } catch { /* No provider bodies in errors. */ }
    throw new Error(
      notices[code] ?? "The upload request could not be confirmed. Check this job before retrying.",
    );
  }
  return data as T;
}
// A streaming, versioned fingerprint: SHA-256 of the ordered SHA-256 chunk digests.
// Bounded memory even for 1 GiB files. Both create and resume use the same algorithm.
export async function fileFingerprint(file: Blob, signal?: AbortSignal) {
  const parts: Uint8Array[] = [];
  for (let offset = 0; offset < file.size; offset += 8 * 1024 * 1024) {
    signal?.throwIfAborted();
    parts.push(
      new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          await file.slice(offset, offset + 8 * 1024 * 1024).arrayBuffer(),
        ),
      ),
    );
  }
  signal?.throwIfAborted();
  const bytes = new Uint8Array(parts.length * 32);
  parts.forEach((part, index) => bytes.set(part, index * 32));
  const result = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(result)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
export async function fileDuration(file: File, signal: AbortSignal): Promise<number> {
  const url = URL.createObjectURL(file), video = document.createElement("video");
  try {
    return await new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        video.onloadedmetadata = null;
        video.onerror = null;
      };
      const fail = () => {
        cleanup();
        reject(new Error("Could not read the video duration. Choose an MP4 video."));
      };
      const abort = () => {
        cleanup();
        reject(new DOMException("Stopped", "AbortError"));
      };
      const timer = setTimeout(fail, 15000);
      signal.addEventListener("abort", abort, { once: true });
      video.onloadedmetadata = () => {
        cleanup();
        resolve(video.duration);
      };
      video.onerror = fail;
      video.preload = "metadata";
      video.src = url;
      if (signal.aborted) abort();
    });
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}
