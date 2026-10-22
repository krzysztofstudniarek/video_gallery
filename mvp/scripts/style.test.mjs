import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const hook = join(root, ".githooks/pre-commit");
const valid = "export const same = (value: number) => value === 1;\n";

function fixture(t, staged, working = staged) {
  const directory = mkdtempSync(join(tmpdir(), "videoalbum-hook-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(join(directory, "mvp/frontend"), { recursive: true });
  copyFileSync(join(root, "mvp/deno.json"), join(directory, "mvp/deno.json"));
  copyFileSync(join(root, ".editorconfig"), join(directory, ".editorconfig"));
  symlinkSync(join(root, "mvp/node_modules"), join(directory, "mvp/node_modules"), "dir");
  const source = join(directory, "mvp/frontend/check.ts");
  const git = (...args) => {
    const result = spawnSync("git", args, { cwd: directory, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  git("init", "--quiet");
  writeFileSync(source, staged);
  git("add", ".editorconfig", "mvp/deno.json", "mvp/frontend/check.ts");
  writeFileSync(source, working);
  const result = spawnSync(hook, [], { cwd: directory, encoding: "utf8" });
  assert.equal(readFileSync(source, "utf8"), working, "hook must not rewrite the working tree");
  assert.equal(git("show", ":mvp/frontend/check.ts"), staged, "hook must not restage files");
  return result;
}

test("commit hook checks staged files even when unstaged edits are unformatted", (t) => {
  const result = fixture(t, valid, "export const same=(value:number)=>value===1\n");
  assert.equal(result.status, 0, result.stderr);
});

test("commit hook rejects unformatted staged content even when the working tree is fixed", (t) => {
  const result = fixture(t, "export const same=(value:number)=>value===1\n", valid);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /not formatted/);
});

test("commit hook rejects formatted code that violates the shared lint rules", (t) => {
  const result = fixture(t, "export const same = (value: number) => value == 1;\n");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /eqeqeq/);
});
