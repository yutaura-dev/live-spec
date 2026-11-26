import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

// spec はほかのファイルと別に、単独で型を確かめる（利用側の tsconfig.json の設定に左右されないため）。
// --allowImportingTsExtensions を付ける理由: spec は Node で直接実行するので、相対 import に .ts の拡張子を書くことがある。
const TSC_FLAGS = [
  "--noEmit",
  "--strict",
  "--module",
  "nodenext",
  "--moduleResolution",
  "nodenext",
  "--target",
  "es2024",
  "--skipLibCheck",
  "--allowImportingTsExtensions",
];

// live-spec に typescript を同梱しない理由: 利用側の typescript の版と型の解決（@types など）に合わせるため。
export const findTsc = (cwd: string): string | null => {
  try {
    const pkgPath = createRequire(join(cwd, "package.json")).resolve("typescript/package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { bin?: string | Record<string, string> };
    const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.tsc;
    return bin === undefined ? null : join(dirname(pkgPath), bin);
  } catch {
    return null;
  }
};

export const typecheck = (tsc: string, files: ReadonlyArray<string>): { readonly ok: boolean; readonly output: string } => {
  const run = (extra: ReadonlyArray<string>) => spawnSync(process.execPath, [tsc, ...TSC_FLAGS, ...extra, ...files], { encoding: "utf8" });
  // --ignoreConfig は、ファイルを指定しても tsconfig.json を読もうとする TypeScript 6 以降で要る。
  // 5 系はこのオプションを知らないので、知らないと言われたら外して実行し直す。
  let result = run(["--ignoreConfig"]);
  const text = `${result.stdout}${result.stderr}`;
  if (/ignoreConfig/.test(text) && /unknown/i.test(text)) result = run([]);
  return { ok: result.status === 0, output: `${result.stdout}${result.stderr}`.trim() };
};
