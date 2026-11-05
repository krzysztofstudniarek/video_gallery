import { readFileSync } from "node:fs";

// Startup can apply migrations. Reveal error summaries, never the credential/status table.
const lines = readFileSync(process.argv[2], "utf8").split(/\r?\n/);
for (const raw of lines) {
  // deno-lint-ignore no-control-regex -- ANSI escape sequences in CLI output.
  const line = raw.replace(/\u001b\[[0-9;]*m/g, "").trim();
  if (!/SQLSTATE|^ERROR:|^failed to|^Applying migration|^Error response from daemon/i.test(line)) {
    continue;
  }
  console.error(
    line
      .replace(/(?:https?|postgres(?:ql)?):\/\/\S+/gi, "[URL removed]")
      .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[JWT removed]")
      .replace(/sb_(?:secret|publishable)_[A-Za-z0-9_-]+/g, "[key removed]"),
  );
}
