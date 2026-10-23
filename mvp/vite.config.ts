import { defineConfig, loadEnv } from "vite";
import { browserPolicy } from "./scripts/browser-policy.mjs";

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const policy = browserPolicy(
    env.VITE_SUPABASE_URL || "http://127.0.0.1:54321",
    command === "serve",
  );
  return {
    plugins: [{
      name: "browser-policy",
      transformIndexHtml: {
        order: "pre",
        handler: () => [{
          tag: "meta",
          attrs: { "http-equiv": "Content-Security-Policy", content: policy },
          injectTo: "head-prepend",
        }],
      },
    }],
  };
});
