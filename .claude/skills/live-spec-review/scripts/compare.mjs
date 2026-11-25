#!/usr/bin/env node
// spec ファイルの「git のリビジョン時点」と「作業ツリー」を live-spec で生成し、振る舞いの違いを Markdown で出す。
// 使い方: node compare.mjs <file.spec.ts> [<base のリビジョン>=HEAD]
import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { diffModels, renderDiff } from "./diff-model.mjs";

const CLI = fileURLToPath(new URL("../../../../src/cli.ts", import.meta.url));
const EMPTY = { states: [], transitions: [], availability: [], findings: [], surfaces: [] };

const [specArg, base = "HEAD"] = process.argv.slice(2);
if (specArg === undefined) {
  console.error("usage: node compare.mjs <file.spec.ts> [<base>=HEAD]");
  process.exit(2);
}
const spec = resolve(specArg);
const root = execFileSync("git", ["-C", dirname(spec), "rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();

const generate = (path) => JSON.parse(execFileSync(process.execPath, [CLI, path, "--json"], { encoding: "utf8" }));

let baseSource;
try {
  baseSource = execFileSync("git", ["-C", root, "show", `${base}:${relative(root, spec)}`], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
} catch {
  baseSource = undefined; // base には spec がない（新しく作った spec）
}

let before = EMPTY;
if (baseSource !== undefined) {
  // 元の spec と同じディレクトリに置く理由: spec が相対パスで import しているファイルを、
  // 変更前の spec からも同じように解決できるようにするため。
  const tmp = join(dirname(spec), `.${basename(spec).replace(/\.ts$/, "")}.base.ts`);
  writeFileSync(tmp, baseSource);
  try {
    before = generate(tmp);
  } finally {
    rmSync(tmp, { force: true });
  }
}
process.stdout.write(renderDiff(diffModels(before, generate(spec))));
