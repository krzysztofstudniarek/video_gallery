import type { SupabaseClient } from "npm:@supabase/supabase-js@2.118.0";
export type Credentials = { refresh_cipher: string; channel_id: string; channel_title: string };
export type UploadJob = {
  job_id: string;
  session_cipher: string | null;
  size_bytes: number;
  file_sha256: string;
  created_at: string;
};

// One repository per verified identity; request payloads cannot override its owner.
export class YoutubeRepository {
  constructor(private client: SupabaseClient, readonly owner: string) {}
  private async call<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    const { data, error } = await this.client.rpc(name, { ...args, p_owner: this.owner });
    if (error) throw new Error("database_operation_failed");
    return data as T;
  }
  async credentials() {
    return (await this.call<Credentials[]>("yt_probe_credentials"))[0];
  }
  async job() {
    return (await this.call<UploadJob[]>("yt_probe_job"))[0];
  }
  start(stateHash: string, verifier: string) {
    return this.call("yt_probe_start", { p_hash: stateHash, p_verifier: verifier });
  }
  async consume(stateHash: string) {
    return (await this.call<{ verifier: string }[]>("yt_probe_consume", { p_hash: stateHash }))[0];
  }
  save(cipher: string, channel: string, title: string) {
    return this.call("yt_probe_save", { p_cipher: cipher, p_channel: channel, p_title: title });
  }
  forget() {
    return this.call("yt_probe_forget");
  }
  clearJob() {
    return this.call("yt_probe_clear_job");
  }
  reserve(job: string, size: number, sha256: string) {
    return this.call("yt_probe_reserve", { p_job: job, p_size: size, p_hash: sha256 });
  }
  saveSession(job: string, cipher: string) {
    return this.call("yt_probe_session", { p_job: job, p_cipher: cipher });
  }
}
