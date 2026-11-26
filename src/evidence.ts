import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, parse, resolve } from "node:path";
import type { Spec } from "./load.ts";
import type { Finding } from "./model.ts";

const LOCATION = /^(.*?)(?::(\d+)(?:-(\d+))?)?$/;

interface Location {
  readonly path: string;
  readonly last: number;
}

// 1 行に並べた複数の場所を読む（「a.ts:1-2、b.ts:4」「a.ts:186、:877-879」）。補足の括弧の中に「、」や
// 「server.listen(port, ...)」のような文字列があっても場所と取り違えないよう、括弧を取り除いてから区切る。
// 2 つ目以降は、場所らしいもの（「:数字」の省略形か、/ や拡張子を含むもの）だけを読む。
export const evidenceLocations = (text: string): Array<Location> => {
  let body = text;
  for (let previous = ""; previous !== body; ) {
    previous = body;
    body = body.replace(/（[^（）]*）/g, " ").replace(/\([^()]*\)/g, " ");
  }
  const locations: Array<Location> = [];
  let currentPath: string | null = null;
  for (const [i, segment] of body.split(/[、,]/).entries()) {
    const token = segment.trim().split(/\s+/)[0] ?? "";
    const looksLikeLocation = /^:\d/.test(token) || token.includes("/") || /\.[A-Za-z][A-Za-z0-9]*(?::\d|$)/.test(token);
    if (token === "" || (i > 0 && !looksLikeLocation)) continue;
    const m = LOCATION.exec(token);
    if (m === null) continue;
    const [, rawPath, start, end] = m;
    const path: string | null = rawPath === "" ? currentPath : (rawPath ?? null);
    if (path === null) continue;
    currentPath = path;
    locations.push({ path, last: Number(end ?? start ?? 0) });
  }
  return locations;
};

const gitRoot = (dir: string): string | null => {
  try {
    return execFileSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
};

// 起点の候補を順に試す理由: 既存のコードから書き起こした spec は、根拠のコードとは別の場所（別のリポジトリなど）に
// 置かれることがある。evidenceRoot を書けばそこを、書かなければ spec のある git のルート、spec の上のディレクトリを探す。
const rootsFor = (spec: Spec, specPath: string): Array<string> => {
  const specDir = dirname(resolve(specPath));
  const ancestors: Array<string> = [];
  for (let dir = specDir; ; dir = dirname(dir)) {
    ancestors.push(dir);
    if (dir === parse(dir).root) break;
  }
  if (spec.evidenceRoot !== null) return [resolve(specDir, spec.evidenceRoot)];
  const git = gitRoot(specDir);
  return git === null ? ancestors : [git, ...ancestors];
};

const lineCount = (path: string) => readFileSync(path, "utf8").replace(/\n$/, "").split("\n").length;

export const checkEvidence = (spec: Spec, specPath: string): Array<Finding> => {
  const roots = rootsFor(spec, specPath);
  return Object.entries(spec.evidence).flatMap(([action, items]) =>
    items.flatMap((evidence): Array<Finding> =>
      evidenceLocations(evidence).flatMap(({ path, last }): Array<Finding> => {
        const file = roots.map((root) => join(root, path)).find((p) => existsSync(p));
        if (file === undefined) return [{ kind: "evidence-missing", action, evidence }];
        if (last === 0) return [];
        const lines = lineCount(file);
        return last > lines ? [{ kind: "evidence-out-of-range", action, evidence, lines }] : [];
      }),
    ),
  );
};
