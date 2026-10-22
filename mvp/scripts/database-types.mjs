import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const target = new URL("../frontend/database.types.ts", import.meta.url);
const workspace = new URL("../", import.meta.url);
const executable = fileURLToPath(new URL("node_modules/.bin/supabase", workspace));
const result = spawnSync(executable, [
  "gen",
  "types",
  "typescript",
  "--local",
  "--schema",
  "public",
], {
  cwd: workspace,
  encoding: "utf8",
});
if (result.error || result.status !== 0 || !result.stdout.includes("export type Database =")) {
  console.error("Local database type generation failed. Start and reset local Supabase first.");
  process.exit(1);
}
const formatted = spawnSync(fileURLToPath(new URL("node_modules/.bin/deno", workspace)), [
  "fmt",
  "--ext=ts",
  "-",
], { cwd: workspace, input: result.stdout, encoding: "utf8" });
if (formatted.error || formatted.status !== 0) {
  console.error("Database type formatting failed.");
  process.exit(1);
}
const generated = formatted.stdout;
if (process.argv.includes("--check")) {
  let current;
  try {
    current = readFileSync(target, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (current !== generated) {
    console.error("Database types differ. Run npm run types:db after applying migrations.");
    process.exit(1);
  }
} else {
  writeFileSync(target, generated);
}
