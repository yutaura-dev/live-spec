import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, parse, resolve } from "node:path";
import type { Spec } from "./load.ts";
import type { Finding } from "./model.ts";
import { splitEvidence } from "./render/markdown.ts";

const LOCATION = /^(.+?)(?::(\d+)(?:-(\d+))?)?$/;

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
    items.flatMap((evidence): Array<Finding> => {
      const m = LOCATION.exec(splitEvidence(evidence).path);
      if (m === null) return [];
      const [, path, start, end] = m;
      const file = roots.map((root) => join(root, path!)).find((p) => existsSync(p));
      if (file === undefined) return [{ kind: "evidence-missing", action, evidence }];
      const last = Number(end ?? start ?? 0);
      if (last === 0) return [];
      const lines = lineCount(file);
      return last > lines ? [{ kind: "evidence-out-of-range", action, evidence, lines }] : [];
    }),
  );
};
