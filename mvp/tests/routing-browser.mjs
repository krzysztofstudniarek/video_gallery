import { spawnSync } from "node:child_process";
const base = process.env.ROUTING_BASE_PATH || "/";
if (!/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(base)) throw new Error("Invalid routing test base");
const env = {
  ...process.env,
  ROUTING_BASE_PATH: base,
  VITE_SUPABASE_URL: "http://127.0.0.1:54321",
  VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_routing_synthetic",
};
for (
  const args of [["node_modules/vite/bin/vite.js", "build", "--base", base], [
    "node_modules/@playwright/test/cli.js",
    "test",
    "--config",
    "playwright.routing.config.ts",
  ]]
) {
  const result = spawnSync(process.execPath, args, { env, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status || 1);
}
