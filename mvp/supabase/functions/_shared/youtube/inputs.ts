import { ActionError } from "./errors.ts";
import { maxBytes } from "./google.ts";
export type CompleteInput = { action: "complete"; code: string; state: string };
export type InitiateInput = {
  action: "initiate";
  channel_id: string;
  confirmed_unlisted: true;
  made_for_kids: boolean;
  size: number;
  mime: "video/mp4";
  sha256: string;
};
export type ResumeInput = { action: "resume"; size: number; sha256: string };
export type VerifyInput = { action: "verify"; video_id: string };
export type ActionInput = CompleteInput | InitiateInput | ResumeInput | VerifyInput | {
  action: "status" | "start" | "refresh" | "disconnect" | "clear_job" | "inspect";
};
export function parseAction(value: unknown): ActionInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ActionError("invalid_request", 400);
  }
  const body = value as Record<string, unknown>;
  switch (body.action) {
    case "status":
    case "start":
    case "refresh":
    case "disconnect":
    case "clear_job":
    case "inspect":
      return { action: body.action };
    case "complete":
      if (
        typeof body.state !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(body.state) ||
        typeof body.code !== "string" || !body.code || body.code.length > 4096
      ) throw new ActionError("invalid_consent", 400);
      return { action: "complete", code: body.code, state: body.state };
    case "initiate":
      if (
        body.confirmed_unlisted !== true || typeof body.channel_id !== "string" ||
        typeof body.made_for_kids !== "boolean" || typeof body.size !== "number" ||
        !Number.isInteger(body.size) || body.size < 1 || body.size > maxBytes ||
        body.mime !== "video/mp4" ||
        typeof body.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(body.sha256)
      ) throw new ActionError("invalid_upload_confirmation", 400);
      return {
        action: "initiate",
        confirmed_unlisted: true,
        channel_id: body.channel_id,
        made_for_kids: body.made_for_kids,
        size: body.size,
        mime: "video/mp4",
        sha256: body.sha256,
      };
    case "resume":
      if (
        typeof body.size !== "number" || !Number.isInteger(body.size) || body.size < 1 ||
        body.size > maxBytes ||
        typeof body.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(body.sha256)
      ) throw new ActionError("choose_original_file", 400);
      return { action: "resume", size: body.size, sha256: body.sha256 };
    case "verify":
      if (typeof body.video_id !== "string" || !/^[A-Za-z0-9_-]{11}$/.test(body.video_id)) {
        throw new ActionError("invalid_video", 400);
      }
      return { action: "verify", video_id: body.video_id };
    default:
      throw new ActionError("invalid_action", 400);
  }
}
