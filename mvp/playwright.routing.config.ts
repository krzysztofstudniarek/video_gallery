import { defineConfig } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";

export default defineConfig({
  testDir: "./routing-e2e",
  workers: 1,
  reporter: "line",
  outputDir: join(tmpdir(), "videoalbum-routing-results"),
  use: {
    baseURL: `http://127.0.0.1:5174${process.env.ROUTING_BASE_PATH || "/"}`,
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  webServer: {
    command: "node scripts/serve-built.mjs",
    url: `http://127.0.0.1:5174${process.env.ROUTING_BASE_PATH || "/"}`,
    reuseExistingServer: false,
  },
});
