// tsc の rewriteRelativeImportExtensions は JS の import だけを書き換え、型定義（.d.ts）には ./foo.ts を残す。
// 利用者の TypeScript は .ts の拡張子を持つ import を（設定によっては）解決できないので、配布前に .js へそろえる。
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)]));

for (const file of walk(process.argv[2] ?? "dist").filter((f) => f.endsWith(".d.ts"))) {
  const text = readFileSync(file, "utf8");
  const next = text.replace(/((?:from|import)\s*\(?\s*["'])(\.{1,2}\/[^"']+)\.ts(["'])/g, "$1$2.js$3");
  if (next !== text) writeFileSync(file, next);
}
