import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.118.0";
import { requireUser } from "./auth.ts";
import { type Env, runtimeConfig } from "./youtube/config.ts";
import { ActionError } from "./youtube/errors.ts";
import { corsHeaders, readJson } from "./youtube/http.ts";
import { seal, unseal } from "./youtube/crypto.ts";
import { isUuid, uploadMetadata, uploadRequest, verifyProviderVideo } from "./upload-policy.ts";
import {
  providerJson,
  providerVideo,
  sessionStatus,
  startProviderUpload,
} from "./upload-provider.ts";

type JobContext = {
  limits: { max_bytes: number; max_seconds: number };
  job: {
    id: string;
    workflow_id: string;
    video_id: string;
    state: string;
    requested_visibility: string;
    public_confirmed_at: string | null;
    upload_title: string;
    upload_description: string;
    provider_video_id: string | null;
    processing_status: string;
    effective_visibility: string | null;
    verified_size_bytes: number | null;
    verified_duration_seconds: number | null;
    verified_at: string | null;
    channel_verified: boolean;
  };
  control: {
    declared_bytes: number;
    file_sha256: string;
    made_for_kids: boolean;
    dispatched_at: string | null;
    ambiguous: boolean;
    failure_code: string | null;
    poll_count: number;
  };
  session: { session_cipher: string; key_id: string } | null;
  connection: {
    workflow_id: string;
    channel_id: string;
    refresh_cipher: string;
    key_id: string;
    expires_at: string;
  };
};
export class UploadCoordinator {
  constructor(
    private admin: SupabaseClient,
    private owner: string,
    private env: Env,
    private origin: string,
    private send: typeof fetch,
  ) {}
  async rpc(name: string, args: Record<string, unknown> = {}) {
    const { data, error } = await this.admin.rpc(name, { p_owner: this.owner, ...args });
    if (error) {
      const allowed = [
        "workflow_unavailable",
        "invalid_upload_request",
        "idempotency_conflict",
        "idempotency_already_finished",
        "batch_capacity",
        "video_capacity",
        "album_capacity",
        "verification_required",
      ];
      throw new ActionError(
        allowed.includes(error.message) ? error.message : "upload_database_unavailable",
        409,
      );
    }
    return data;
  }
  async context(job: string): Promise<JobContext> {
    const data = await this.rpc("upload_job_context", { p_job: job });
    if (!data || Date.parse(data.connection.expires_at) <= Date.now()) {
      throw new ActionError("workflow_unavailable", 409);
    }
    return data;
  }
  key(id: string) {
    const keys = JSON.parse(this.env("YOUTUBE_TOKEN_KEYS_JSON") ?? "{}");
    if (!Object.hasOwn(keys, id) || typeof keys[id] !== "string") {
      throw new ActionError("uploads_not_configured", 503);
    }
    return keys[id] as string;
  }
  async token(context: JobContext) {
    const c = context.connection;
    const refresh = await unseal(
      this.key(c.key_id),
      this.owner,
      `workflow:${c.workflow_id}:refresh:${c.key_id}`,
      c.refresh_cipher,
    );
    const id = this.env("YOUTUBE_CLIENT_ID"), secret = this.env("YOUTUBE_CLIENT_SECRET");
    if (!id || !secret) throw new ActionError("uploads_not_configured", 503);
    await this.context(context.job.id);
    let result;
    try {
      result = await providerJson(this.send, "https://oauth2.googleapis.com/token", {
        method: "POST",
        body: new URLSearchParams({
          client_id: id,
          client_secret: secret,
          grant_type: "refresh_token",
          refresh_token: refresh,
        }),
      });
    } catch (error) {
      if (error instanceof ActionError && error.code === "reconnect_youtube") {
        await this.rpc("finish_upload_workflow", { p_workflow: c.workflow_id });
      }
      throw error;
    }
    if (typeof result.access_token !== "string" || !result.access_token) {
      throw new ActionError("reconnect_youtube", 409);
    }
    if (
      typeof result.refresh_token === "string" && result.refresh_token &&
      result.refresh_token !== refresh
    ) {
      if (
        !await this.rpc("rotate_channel_library_credential", {
          p_workflow: c.workflow_id,
          p_previous_cipher: c.refresh_cipher,
          p_key_id: c.key_id,
          p_cipher: await seal(
            this.key(c.key_id),
            this.owner,
            `workflow:${c.workflow_id}:refresh:${c.key_id}`,
            result.refresh_token,
          ),
        })
      ) {
        throw new ActionError("workflow_unavailable", 409);
      }
    }
    await this.context(context.job.id);
    return result.access_token as string;
  }
  async providerOperation<T>(c: JobContext, operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof ActionError && error.code === "reconnect_youtube") {
        await this.rpc("finish_upload_workflow", { p_workflow: c.job.workflow_id });
      }
      throw error;
    }
  }
  publicStatus(c: JobContext) {
    const complete = c.job.state === "uploaded" && c.job.processing_status === "succeeded" &&
      c.job.channel_verified &&
      c.job.effective_visibility === c.job.requested_visibility &&
      c.job.verified_size_bytes !== null &&
      c.job.verified_duration_seconds !== null && !c.control.failure_code &&
      Number(c.job.verified_size_bytes) > 0 &&
      Number(c.job.verified_size_bytes) <= c.limits.max_bytes &&
      Number(c.job.verified_duration_seconds) > 0 &&
      Number(c.job.verified_duration_seconds) <= c.limits.max_seconds;
    const qrEligible = complete &&
      ["public", "unlisted"].includes(c.job.effective_visibility ?? "") &&
      /^[A-Za-z0-9_-]{11}$/.test(c.job.provider_video_id ?? "") &&
      (c.job.requested_visibility !== "public" || !!c.job.public_confirmed_at) &&
      !!c.job.verified_at && Date.parse(c.job.verified_at) > Date.now() - 5 * 60 * 1000;
    return {
      jobId: c.job.id,
      workflowId: c.job.workflow_id,
      expiresAt: c.connection.expires_at,
      state: c.control.failure_code
        ? "failed"
        : c.control.ambiguous
        ? "ambiguous"
        : complete
        ? "completed"
        : c.job.state === "uploaded"
        ? "processing"
        : c.job.state,
      requestedVisibility: c.job.requested_visibility,
      effectiveVisibility: c.job.effective_visibility,
      failure: c.control.failure_code,
      pollCount: c.control.poll_count,
      qrEligible,
    };
  }
  async act(input: Record<string, unknown>) {
    if (input.action === "create") {
      const r = uploadRequest(input);
      const jobId = await this.rpc("create_upload_job", {
        p_workflow: r.workflowId,
        p_key: r.key,
        p_title: r.title,
        p_description: r.description,
        p_caption: r.caption,
        p_visibility: r.visibility,
        p_public: r.confirmPublic,
        p_size: r.size,
        p_hash: r.sha256,
        p_kids: r.madeForKids,
      });
      return this.publicStatus(await this.context(jobId));
    }
    if (input.action === "destinations") {
      if (
        !Array.isArray(input.choices) || !input.choices.length || input.choices.length > 10 ||
        new Set(input.choices.map((choice: Record<string, unknown>) => choice?.jobId)).size !==
          input.choices.length
      ) throw new ActionError("invalid_selection", 400);
      const entries = [];
      for (const choice of input.choices) {
        if (
          !choice || !isUuid(choice.jobId) || !isUuid(choice.videoId) || !isUuid(choice.workflowId)
        ) throw new ActionError("invalid_selection", 400);
        const current = await this.context(choice.jobId);
        if (
          current.job.video_id !== choice.videoId ||
          current.job.workflow_id !== choice.workflowId || !this.publicStatus(current).qrEligible ||
          !current.job.provider_video_id ||
          !/^[A-Za-z0-9_-]{11}$/.test(current.job.provider_video_id)
        ) throw new ActionError("verification_required", 409);
        entries.push({
          jobId: choice.jobId,
          videoId: choice.videoId,
          workflowId: choice.workflowId,
          destination: "",
        });
      }
      for (const entry of entries) {
        if (!this.publicStatus(await this.context(entry.jobId)).qrEligible) {
          throw new ActionError("verification_required", 409);
        }
        const destination = await this.rpc("current_upload_destination", {
          p_job: entry.jobId,
          p_video: entry.videoId,
          p_workflow: entry.workflowId,
        });
        if (
          typeof destination !== "string" ||
          !/^https:\/\/www\.youtube\.com\/watch\?v=[A-Za-z0-9_-]{11}$/.test(destination)
        ) throw new ActionError("verification_required", 409);
        entry.destination = destination;
      }
      return { entries };
    }
    if (["delivery", "downloads", "downloaded", "finish"].includes(String(input.action))) {
      if (!isUuid(input.workflowId)) throw new ActionError("invalid_workflow", 400);
      const workflow = input.workflowId;
      if (input.action === "delivery") {
        const result = await this.rpc("upload_delivery_context", { p_workflow: workflow });
        if (!result) {
          if (await this.rpc("upload_delivery_receipt", { p_workflow: workflow })) {
            return { completed: true, workflowId: workflow };
          }
          throw new ActionError("workflow_unavailable", 409);
        }
        return result;
      }
      if (input.action === "downloads") {
        return this.rpc("prepare_upload_downloads", { p_workflow: workflow });
      }
      if (!isUuid(input.batchId)) throw new ActionError("invalid_batch", 400);
      if (input.action === "downloaded") {
        if (!["sheet", "individual", "links"].includes(String(input.kind))) {
          throw new ActionError("invalid_download_kind", 400);
        }
        if (
          !await this.rpc("acknowledge_upload_download", {
            p_workflow: workflow,
            p_batch: input.batchId,
            p_kind: input.kind,
          })
        ) throw new ActionError("download_batch_expired", 409);
        return { acknowledged: true };
      }
      if (input.confirmSaved !== true) throw new ActionError("confirm_saved_downloads", 400);
      if (
        !await this.rpc("complete_upload_delivery", {
          p_workflow: workflow,
          p_batch: input.batchId,
        })
      ) throw new ActionError("downloads_required_or_changed", 409);
      return { completed: true, providerVideosUnchanged: true };
    }
    if (!isUuid(input.jobId)) throw new ActionError("invalid_job", 400);
    const job = input.jobId;
    let c: JobContext;
    try {
      c = await this.context(job);
    } catch (error) {
      if (
        input.action === "status" && error instanceof ActionError &&
        error.code === "workflow_unavailable"
      ) {
        const receipt = await this.rpc("upload_job_receipt", { p_job: job });
        if (receipt) {
          return {
            ...receipt,
            expiresAt: null,
            qrEligible: false,
            pollCount: 0,
          };
        }
      }
      throw error;
    }
    if (input.action === "status") return this.publicStatus(c);
    if (input.action === "cancel") {
      if (!await this.rpc("cancel_upload_job", { p_job: job })) {
        throw new ActionError("workflow_unavailable", 409);
      }
      return { cancelled: true, providerVideoMayRemain: true };
    }
    if (input.action === "permit" || input.action === "resume" || input.action === "dispatch") {
      if (!isUuid(input.lease)) throw new ActionError("invalid_lease", 400);
      if (
        input.action !== "permit" &&
        (input.size !== Number(c.control.declared_bytes) || input.sha256 !== c.control.file_sha256)
      ) {
        throw new ActionError("choose_original_file", 400);
      }
      if (input.action === "dispatch") {
        if (c.job.state !== "queued" || c.control.dispatched_at) {
          throw new ActionError("reconcile_existing_job", 409);
        }
        // Validate encryption and refresh credentials before consuming a dispatch claim.
        const keyId = this.env("YOUTUBE_TOKEN_ACTIVE_KEY_ID");
        if (!keyId) throw new ActionError("uploads_not_configured", 503);
        const key = this.key(keyId);
        await seal(key, this.owner, `upload:${job}:${keyId}`, "configuration");
        const token = await this.token(c);
        const claim = await this.rpc("claim_upload_dispatch", { p_job: job, p_lease: input.lease });
        if (claim !== "claimed") throw new ActionError(String(claim), 409);
        c = await this.context(job);
        const session = await this.providerOperation(c, () =>
          startProviderUpload(
            this.send,
            token,
            this.origin,
            Number(c.control.declared_bytes),
            uploadMetadata(c.job, c.control.made_for_kids),
          ));
        if (
          !await this.rpc("save_upload_session", {
            p_job: job,
            p_lease: input.lease,
            p_key_id: keyId,
            p_cipher: await seal(key, this.owner, `upload:${job}:${keyId}`, session),
          })
        ) throw new ActionError("initiation_uncertain_reconcile", 409);
        // Recheck disconnect/cancellation after provider response and before returning capability.
        await this.context(job);
        return { sessionUrl: session, jobId: job };
      }
      if (
        !await this.rpc("upload_transfer_permit", {
          p_job: job,
          p_lease: input.lease,
          p_acquire: input.action === "resume",
        })
      ) {
        throw new ActionError("transfer_busy_or_expired", 409);
      }
      if (input.action === "permit") return { permitted: true };
      c = await this.context(job);
      if (!c.session) throw new ActionError("completion_uncertain", 409);
      const session = await unseal(
        this.key(c.session.key_id),
        this.owner,
        `upload:${job}:${c.session.key_id}`,
        c.session.session_cipher,
      );
      await this.context(job);
      return { sessionUrl: session, jobId: job };
    }
    if (input.action !== "reconcile" && input.action !== "preprint") {
      throw new ActionError("invalid_action", 400);
    }
    if (!await this.rpc("upload_poll_claim", { p_job: job })) {
      throw new ActionError("poll_budget_or_cooldown", 429);
    }
    if (c.job.state === "failed") return this.publicStatus(c);
    let id = c.job.provider_video_id;
    if (!id) {
      if (!c.session) throw new ActionError("initiation_uncertain_no_restart", 409);
      await this.context(job);
      const session = await unseal(
        this.key(c.session.key_id),
        this.owner,
        `upload:${job}:${c.session.key_id}`,
        c.session.session_cipher,
      );
      const status = await sessionStatus(this.send, session, Number(c.control.declared_bytes));
      if (!status.videoId) {
        await this.context(job);
        return { ...this.publicStatus(c), acceptedBytes: status.offset };
      }
      id = status.videoId;
    }
    const token = await this.token(c);
    await this.context(job);
    const video = await this.providerOperation(c, () => providerVideo(this.send, token, id));
    const verified = verifyProviderVideo(
      video,
      id,
      c.connection.channel_id,
      c.job.requested_visibility,
      { bytes: c.limits.max_bytes, seconds: c.limits.max_seconds },
    );
    const failure = verified.failure ??
      (verified.sizeBytes !== null && verified.sizeBytes !== Number(c.control.declared_bytes)
        ? "file_size_mismatch"
        : null);
    if (
      !await this.rpc("record_upload_result", {
        p_job: job,
        p_video: id,
        p_visibility: verified.visibility,
        p_processing: verified.processing,
        p_channel: true,
        p_size: verified.sizeBytes,
        p_duration: verified.seconds,
        p_failure: failure,
      })
    ) throw new ActionError("workflow_unavailable", 409);
    const current = await this.context(job);
    return this.publicStatus(current);
  }
}

export function uploadsHandler(env: Env, send: typeof fetch = fetch) {
  const config = runtimeConfig(env);
  const headers = { ...corsHeaders(config.origin), "Cache-Control": "no-store" };
  const reply = (body: unknown, status = 200) => Response.json(body, { status, headers });
  return async (request: Request) => {
    if (request.headers.has("Origin") && request.headers.get("Origin") !== config.origin) {
      return reply({ error: "origin_denied" }, 403);
    }
    if (request.method === "OPTIONS") return new Response(null, { headers });
    if (request.method !== "POST") return reply({ error: "method_not_allowed" }, 405);
    try {
      const { user } = await requireUser(request, config, send);
      const input = await readJson(request, 32 * 1024);
      if (!input || typeof input !== "object" || Array.isArray(input)) {
        throw new ActionError("invalid_request", 400);
      }
      const admin = createClient(config.supabaseUrl, config.serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { fetch: send },
      });
      return reply(
        await new UploadCoordinator(admin, user.id, env, config.origin, send).act(
          input as Record<string, unknown>,
        ),
      );
    } catch (error) {
      if (error instanceof ActionError) return reply({ error: error.code }, error.status);
      return reply({ error: "upload_request_uncertain_reconcile" }, 502);
    }
  };
}
