import { inspectSession } from "./upload-session.ts";
import { googleJson, sessionUrl, tokenRequest, uploadBody } from "./google.ts";
import type { ConsentConfig } from "./config.ts";

export class GoogleClient {
  constructor(private config: ConsentConfig, private send: typeof fetch) {}
  exchange(code: string, verifier: string) {
    return tokenRequest(this.send, this.config.clientId, this.config.secret, {
      grant_type: "authorization_code",
      code,
      redirect_uri: this.config.redirect,
      code_verifier: verifier,
    });
  }
  refresh(refreshToken: string) {
    return tokenRequest(this.send, this.config.clientId, this.config.secret, {
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });
  }
  async channel(accessToken: string) {
    const result = await googleJson(
      this.send,
      "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",
      this.auth(accessToken),
    );
    const channel = result.items?.[0];
    if (
      result.items?.length !== 1 || typeof channel?.id !== "string" ||
      !/^UC[A-Za-z0-9_-]{22}$/.test(channel.id)
    ) {
      throw new Error("choose_one_youtube_channel");
    }
    return { id: channel.id as string, title: String(channel.snippet.title).slice(0, 200) };
  }
  async revoke(refreshToken: string) {
    const response = await this.send("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      body: new URLSearchParams({ token: refreshToken }),
      signal: AbortSignal.timeout(15000),
      redirect: "error",
    });
    if (!response.ok) throw new Error("revocation_failed");
  }
  async initiate(accessToken: string, job: string, size: number, madeForKids: boolean) {
    const response = await this.send(
      "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
      {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(15000),
        headers: {
          ...this.auth(accessToken).headers,
          // Initiation runs server-side; preserve the browser origin for CORS-aware sessions.
          Origin: new URL(this.config.redirect).origin,
          "Content-Type": "application/json",
          "X-Upload-Content-Type": "video/mp4",
          "X-Upload-Content-Length": String(size),
        },
        body: JSON.stringify(uploadBody(job, madeForKids)),
      },
    );
    if (!response.ok) throw new Error("upload_initiation_failed");
    return sessionUrl(response.headers.get("Location") ?? "");
  }
  async video(accessToken: string, videoId: string) {
    const result = await googleJson(
      this.send,
      `https://www.googleapis.com/youtube/v3/videos?part=snippet,status,processingDetails&id=${videoId}`,
      this.auth(accessToken),
    );
    return result.items?.[0];
  }
  inspectSession(session: string, size: number) {
    return inspectSession(this.send, this.config.redirect, session, size);
  }
  private auth(accessToken: string) {
    return { headers: { Authorization: `Bearer ${accessToken}` } };
  }
}
