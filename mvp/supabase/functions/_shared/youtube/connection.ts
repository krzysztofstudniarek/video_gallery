import type { ConsentConfig } from "./config.ts";
import type { YoutubeRepository } from "./repository.ts";
import { type Context, requireConnection } from "./context.ts";

export async function connectionStatus(
  repository: YoutubeRepository,
  config: ConsentConfig | null,
) {
  const row = await repository.credentials(), job = await repository.job();
  return {
    configured: !!config,
    connected: !!row,
    channel: row ? { id: row.channel_id, title: row.channel_title } : null,
    job: job ? { id: job.job_id, size: Number(job.size_bytes), ready: !!job.session_cipher } : null,
  };
}
export async function refreshAccess(context: Context) {
  const row = await requireConnection(context);
  const refreshed = await context.google.refresh(
    await context.cipher.unseal("refresh", row.refresh_cipher),
  );
  if (refreshed.refresh_token) {
    await context.repository.save(
      await context.cipher.seal("refresh", refreshed.refresh_token),
      row.channel_id,
      row.channel_title,
    );
  }
  return { row, accessToken: refreshed.access_token as string };
}
export async function disconnect(context: Context) {
  const row = await requireConnection(context);
  await context.google.revoke(await context.cipher.unseal("refresh", row.refresh_cipher));
  await context.repository.forget();
  return { disconnected: true };
}
