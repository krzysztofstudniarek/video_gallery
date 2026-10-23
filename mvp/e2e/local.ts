import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

// Never print raw CLI output: it includes local backend keys.
export const local = JSON.parse(
  execFileSync("node_modules/.bin/supabase", ["status", "-o", "json"], {
    stdio: ["ignore", "pipe", "pipe"],
  }).toString(),
);
if (!["127.0.0.1", "localhost"].includes(new URL(local.API_URL).hostname)) {
  throw new Error("Browser tests require disposable local Supabase");
}
export const admin = createClient(local.API_URL, local.SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
export async function createAccount() {
  const email = `browser-${randomUUID()}@example.test`, password = randomUUID();
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw new Error("Synthetic browser account creation failed");
  const client = createClient(local.API_URL, local.ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const result = await client.auth.signInWithPassword({ email, password });
  if (result.error || !result.data.session) throw new Error("Synthetic browser sign-in failed");
  return { id: created.data.user.id, email, session: result.data.session };
}
