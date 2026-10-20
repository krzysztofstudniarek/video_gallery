import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import {
  authorizeUrl,
  googleJson,
  hash,
  maxBytes,
  randomSecret,
  scopes,
  seal,
  sessionUrl,
  tokenRequest,
  unseal,
  uploadBody,
} from "./youtube.ts";

type Env = (name: string) => string | undefined;
export function youtubeHandler(env: Env, send: typeof fetch = fetch) {
  return async (request: Request) => {
    const origin = env("FRONTEND_ORIGIN") ?? "http://127.0.0.1:5173";
    const headers = {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "Vary": "Origin",
    };
    const reply = (body: unknown, status = 200) => Response.json(body, { status, headers });
    if (request.headers.get("Origin") && request.headers.get("Origin") !== origin) {
      return reply({ error: "origin_denied" }, 403);
    }
    if (request.method === "OPTIONS") return new Response(null, { headers });
    if (request.method !== "POST") return reply({ error: "method_not_allowed" }, 405);
    const token = request.headers.get("Authorization")?.match(/^Bearer (.+)$/)?.[1];
    if (!token) return reply({ error: "sign_in_required" }, 401);
    try {
      const auth = createClient(env("SUPABASE_URL")!, env("SUPABASE_ANON_KEY")!, {
        auth: { persistSession: false },
        global: { fetch: send },
      });
      const { data: { user }, error } = await auth.auth.getUser(token);
      if (error || !user) return reply({ error: "sign_in_required" }, 401);
      if (Number(request.headers.get("Content-Length") ?? 0) > 8192) {
        return reply({ error: "request_too_large" }, 413);
      }
      const text = await request.text();
      if (text.length > 8192) return reply({ error: "request_too_large" }, 413);
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        return reply({ error: "invalid_request" }, 400);
      }
      if (!body || typeof body !== "object") return reply({ error: "invalid_request" }, 400);
      const admin = createClient(env("SUPABASE_URL")!, env("SUPABASE_SERVICE_ROLE_KEY")!, {
        auth: { persistSession: false },
        global: { fetch: send },
      });
      // Every owner comes from verified Auth, never from request JSON.
      const rpc = async (name: string, args: Record<string, unknown> = {}) => {
        const result = await admin.rpc(name, { ...args, p_owner: user.id });
        if (result.error) throw new Error("database_operation_failed");
        return result.data;
      };
      const credentials = async () => (await rpc("yt_probe_credentials"))?.[0];
      const row = await credentials();
      const clientId = env("YOUTUBE_CLIENT_ID");
      const secret = env("YOUTUBE_CLIENT_SECRET");
      const encryptionKey = env("YOUTUBE_TOKEN_KEY_B64");
      const redirect = env("YOUTUBE_REDIRECT_URI");
      const configured = !!(clientId && secret && encryptionKey && redirect);
      if (body.action === "status") {
        const job = (await rpc("yt_probe_job"))?.[0];
        return reply({
          configured,
          connected: !!row,
          channel: row ? { id: row.channel_id, title: row.channel_title } : null,
          job: job
            ? { id: job.job_id, size: Number(job.size_bytes), ready: !!job.session_cipher }
            : null,
        });
      }
      if (!configured) return reply({ error: "youtube_not_configured" }, 503);
      const redirectUrl = new URL(redirect!);
      if (
        redirectUrl.origin !== origin || redirectUrl.searchParams.get("youtube_callback") !== "1" ||
        (redirectUrl.protocol !== "https:" &&
          !["127.0.0.1", "localhost"].includes(redirectUrl.hostname))
      ) throw new Error("youtube_not_configured");
      // Validate key material before starting consent or consuming an authorization code.
      await seal(encryptionKey!, user.id, "configuration", "check");
      if (body.action === "start") {
        const state = randomSecret(), verifier = randomSecret();
        await rpc("yt_probe_start", { p_hash: await hash(state), p_verifier: verifier });
        return reply({
          authorization_url: authorizeUrl(clientId!, redirect!, state, await hash(verifier)),
        });
      }
      if (body.action === "complete") {
        if (
          typeof body.state !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(body.state) ||
          typeof body.code !== "string" || !body.code || body.code.length > 4096
        ) return reply({ error: "invalid_consent" }, 400);
        const attempt = (await rpc("yt_probe_consume", { p_hash: await hash(body.state) }))?.[0];
        if (!attempt) return reply({ error: "consent_expired_or_used" }, 400);
        const result = await tokenRequest(send, clientId!, secret!, {
          grant_type: "authorization_code",
          code: body.code,
          redirect_uri: redirect!,
          code_verifier: attempt.verifier,
        });
        const granted = String(result.scope ?? "").split(" ");
        if (!scopes.every((scope) => granted.includes(scope)) || !result.refresh_token) {
          throw new Error("consent_missing_permissions");
        }
        const channels = await googleJson(
          send,
          "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",
          { headers: { Authorization: `Bearer ${result.access_token}` } },
        );
        if (channels.items?.length !== 1) throw new Error("choose_one_youtube_channel");
        const channel = channels.items[0];
        if (typeof channel.id !== "string" || !/^UC[A-Za-z0-9_-]{22}$/.test(channel.id)) {
          throw new Error("choose_one_youtube_channel");
        }
        // Avoid mixing a new account's credentials with an earlier account's upload job.
        if (row && row.channel_id !== channel.id) {
          throw new Error("disconnect_before_switching_channel");
        }
        await rpc("yt_probe_save", {
          p_cipher: await seal(encryptionKey!, user.id, "refresh", result.refresh_token),
          p_channel: channel.id,
          p_title: String(channel.snippet.title).slice(0, 200),
        });
        return reply({
          connected: true,
          channel: { id: channel.id, title: channel.snippet.title },
        });
      }
      if (!row) return reply({ error: "connect_youtube_first" }, 409);
      const refresh = await unseal(encryptionKey!, user.id, "refresh", row.refresh_cipher);
      if (body.action === "disconnect") {
        const revoke = await send("https://oauth2.googleapis.com/revoke", {
          method: "POST",
          body: new URLSearchParams({ token: refresh }),
          signal: AbortSignal.timeout(15000),
          redirect: "error",
        });
        if (!revoke.ok) throw new Error("revocation_failed");
        await rpc("yt_probe_forget");
        return reply({ disconnected: true });
      }
      if (body.action === "clear_job") {
        await rpc("yt_probe_clear_job");
        return reply({ cleared: true });
      }
      if (!["refresh", "initiate", "resume", "verify"].includes(body.action)) {
        return reply({ error: "invalid_action" }, 400);
      }
      const refreshed = await tokenRequest(send, clientId!, secret!, {
        grant_type: "refresh_token",
        refresh_token: refresh,
      });
      if (refreshed.refresh_token) {
        await rpc("yt_probe_save", {
          p_cipher: await seal(encryptionKey!, user.id, "refresh", refreshed.refresh_token),
          p_channel: row.channel_id,
          p_title: row.channel_title,
        });
      }
      const authorization = { Authorization: `Bearer ${refreshed.access_token}` };
      if (body.action === "refresh") return reply({ refreshed: true });
      if (body.action === "initiate") {
        if (
          body.confirmed_unlisted !== true || body.channel_id !== row.channel_id ||
          typeof body.made_for_kids !== "boolean" ||
          !Number.isInteger(body.size) || body.size < 1 || body.size > maxBytes ||
          body.mime !== "video/mp4" || typeof body.sha256 !== "string" ||
          !/^[0-9a-f]{64}$/.test(body.sha256)
        ) return reply({ error: "invalid_upload_confirmation" }, 400);
        const existing = (await rpc("yt_probe_job"))?.[0];
        if (existing) return reply({ error: "existing_probe_resume_or_clear" }, 409);
        const job = crypto.randomUUID();
        // Reserve before the provider call; an ambiguous failure cannot silently retry initiation.
        await rpc("yt_probe_reserve", { p_job: job, p_size: body.size, p_hash: body.sha256 });
        const initiated = await send(
          "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
          {
            method: "POST",
            redirect: "error",
            signal: AbortSignal.timeout(15000),
            headers: {
              ...authorization,
              "Content-Type": "application/json",
              "X-Upload-Content-Type": "video/mp4",
              "X-Upload-Content-Length": String(body.size),
            },
            body: JSON.stringify(uploadBody(job, body.made_for_kids)),
          },
        );
        if (!initiated.ok) throw new Error("upload_initiation_failed");
        const session = sessionUrl(initiated.headers.get("Location") ?? "");
        await rpc("yt_probe_session", {
          p_job: job,
          p_cipher: await seal(encryptionKey!, user.id, `upload:${job}`, session),
        });
        return reply({ job_id: job, session_url: session });
      }
      const job = (await rpc("yt_probe_job"))?.[0];
      if (!job || !job.session_cipher) return reply({ error: "no_resumable_probe" }, 409);
      if (body.action === "resume") {
        if (body.size !== Number(job.size_bytes) || body.sha256 !== job.file_sha256) {
          return reply({ error: "choose_original_file" }, 400);
        }
        return reply({
          job_id: job.job_id,
          session_url: sessionUrl(
            await unseal(encryptionKey!, user.id, `upload:${job.job_id}`, job.session_cipher),
          ),
        });
      }
      if (typeof body.video_id !== "string" || !/^[A-Za-z0-9_-]{11}$/.test(body.video_id)) {
        return reply({ error: "invalid_video" }, 400);
      }
      const videos = await googleJson(
        send,
        `https://www.googleapis.com/youtube/v3/videos?part=snippet,status,processingDetails&id=${body.video_id}`,
        { headers: authorization },
      );
      const video = videos.items?.[0];
      if (
        !video || video.snippet.channelId !== row.channel_id ||
        video.snippet.description !== `VideoAlbum probe ${job.job_id}`
      ) return reply({ error: "video_not_this_probe" }, 403);
      const privacy = video.status.privacyStatus;
      const processing = video.processingDetails?.processingStatus ?? video.status.uploadStatus;
      if (
        ["failed", "terminated", "rejected", "deleted"].includes(processing) ||
        ["failed", "rejected", "deleted"].includes(video.status.uploadStatus)
      ) {
        return reply({ error: "upload_processing_failed" }, 409);
      }
      if (privacy !== "unlisted") {
        return reply({ error: "visibility_not_unlisted", privacy, processing }, 409);
      }
      return reply({
        privacy,
        processing,
        verified_unlisted: true,
        ready: processing === "succeeded" || video.status.uploadStatus === "processed",
      });
    } catch (error) {
      const allowed = [
        "reconnect_youtube",
        "consent_missing_permissions",
        "choose_one_youtube_channel",
        "disconnect_before_switching_channel",
        "revocation_failed",
        "upload_initiation_failed",
        "youtube_not_configured",
      ];
      const code = error instanceof Error && allowed.includes(error.message)
        ? error.message
        : "youtube_probe_failed";
      // Never log provider responses, OAuth codes, tokens, session URLs or media.
      return reply({ error: code }, 502);
    }
  };
}
