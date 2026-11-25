// ensure の条件を壊した spec（AI の書き忘れ・書き間違いの再現）に対して、漏れの候補の検査がどれだけ見つけるかを数える。
// 使い方: node scripts/evaluate-omissions.ts <spec のファイルかディレクトリ>...
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { diffModels, groupAvailability, isEmptyDiff } from "../src/diff.ts";
import { explore } from "../src/explore.ts";
import { expandSpecPaths, specNameOf } from "../src/generate.ts";
import { loadSpec, type Spec } from "../src/load.ts";
import { normalize, type Graph } from "../src/model.ts";
import { findOmissionHints, type OmissionHint } from "../src/omission.ts";
import { sourceMutants, type MutationOperator } from "./lib/source-mutants.ts";

let version = 0;
const load = async (path: string, name: string, source: string): Promise<{ spec: Spec; graph: Graph }> => {
  const url = pathToFileURL(resolve(path));
  url.search = `?v=${++version}`;
  const spec = loadSpec(name, (await import(url.href)) as Record<string, unknown>, { source });
  return { spec, graph: explore(spec) };
};

const keyOf = (h: OmissionHint) => JSON.stringify([h.kind, h.action, h.field, h.message]);

type Direction = "looser" | "stricter" | "mixed";
interface Row {
  readonly spec: string;
  readonly operator: MutationOperator;
  readonly action: string;
  readonly reason: string;
  readonly condition: string;
  readonly direction: Direction;
  readonly existing: ReadonlyArray<string>;
  readonly found: ReadonlyArray<string>;
}

const rows: Array<Row> = [];
const baseline: Array<string> = [];
let equivalent = 0;

for (const path of expandSpecPaths(process.argv.slice(2))) {
  const source = readFileSync(path, "utf8");
  const name = specNameOf(path);
  const original = await load(path, name, source);
  const base = findOmissionHints(original.spec, original.graph);
  baseline.push(...base.map((h) => `${name}: ${h.message}`));
  const baseKeys = new Set(base.map(keyOf));
  const tmp = join(dirname(path), `.${basename(path, ".ts")}.mutant.ts`);
  for (const m of sourceMutants(source, original.spec.fields)) {
    writeFileSync(tmp, m.source);
    let mutant;
    try {
      mutant = await load(tmp, name, m.source);
    } finally {
      rmSync(tmp, { force: true });
    }
    const d = diffModels(normalize(original.spec, original.graph), normalize(mutant.spec, mutant.graph));
    if (isEmptyDiff(d)) {
      equivalent++;
      continue;
    }
    const flipped = groupAvailability(d.availability).flipped;
    const gained = flipped.some((a) => a.after.startsWith("✅")) || d.states.added.length > 0;
    const lost = flipped.some((a) => a.before.startsWith("✅")) || d.states.removed.length > 0;
    const direction: Direction = gained && !lost ? "looser" : lost && !gained ? "stricter" : "mixed";
    const fresh = findOmissionHints(mutant.spec, mutant.graph).filter((h) => !baseKeys.has(keyOf(h)));
    rows.push({
      spec: name,
      operator: m.operator,
      action: m.action,
      reason: m.reason,
      condition: m.condition,
      direction,
      existing: [...new Set(d.findings.added.map((f) => String((f as { kind: unknown }).kind)))],
      found: fresh.filter((h) => h.action === m.action || h.action === null).map((h) => h.kind),
    });
  }
}

const summarize = (rs: ReadonlyArray<Row>) => ({
  total: rs.length,
  existing: rs.filter((r) => r.existing.length > 0).length,
  hints: rs.filter((r) => r.found.length > 0).length,
  either: rs.filter((r) => r.existing.length > 0 || r.found.length > 0).length,
});
const by = <K extends string>(keyOf: (r: Row) => K) => {
  const groups = new Map<K, Array<Row>>();
  for (const r of rows) groups.set(keyOf(r), [...(groups.get(keyOf(r)) ?? []), r]);
  return Object.fromEntries([...groups].map(([k, rs]) => [k, summarize(rs)]));
};

console.log(
  JSON.stringify(
    {
      equivalentSkipped: equivalent,
      all: summarize(rows),
      byDirection: by((r) => r.direction),
      byOperator: by((r) => r.operator),
      byOperatorLooser: Object.fromEntries(
        [...new Set(rows.map((r) => r.operator))].map((op) => [op, summarize(rows.filter((r) => r.operator === op && r.direction === "looser"))]),
      ),
      falsePositivesOnOriginal: baseline,
      missedOther: rows
        .filter((r) => r.direction !== "looser" && r.existing.length === 0 && r.found.length === 0)
        .map((r) => `${r.direction} ${r.spec}.${r.action}「${r.reason}」 ${r.operator}: ${r.condition}`),
      missedLooser: rows
        .filter((r) => r.direction === "looser" && r.existing.length === 0 && r.found.length === 0)
        .map((r) => `${r.spec}.${r.action}「${r.reason}」 ${r.operator}: ${r.condition}`),
    },
    null,
    2,
  ),
);
