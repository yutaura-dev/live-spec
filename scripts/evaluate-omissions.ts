// ensure を 1 つずつ外した spec（AI の書き忘れの再現）に対して、漏れの候補の検査がどれだけ見つけるかを数える。
// 使い方: node scripts/evaluate-omissions.ts examples specs
import { explore } from "../src/explore.ts";
import { expandSpecPaths, loadObject } from "../src/generate.ts";
import { findOmissionHints, type OmissionHint } from "../src/omission.ts";

const keyOf = (h: OmissionHint) => JSON.stringify([h.kind, h.action, h.field, h.message]);

const rows: Array<{ spec: string; action: string; reason: string; existing: ReadonlyArray<string>; found: ReadonlyArray<string> }> = [];
const baseline: Array<{ spec: string; hint: OmissionHint }> = [];
let equivalent = 0;

for (const path of expandSpecPaths(process.argv.slice(2))) {
  const { spec, graph } = await loadObject(path);
  const base = findOmissionHints(spec, graph);
  baseline.push(...base.map((hint) => ({ spec: spec.name, hint })));
  const baseKeys = new Set(base.map(keyOf));
  for (const check of graph.ensures ?? []) {
    if (check.verdict === "no-effect") {
      equivalent++;
      continue;
    }
    const bypassEnsure = { action: check.action, reason: check.reason };
    const mutant = explore(spec, { bypassEnsure });
    const fresh = findOmissionHints(spec, mutant, { bypassEnsure }).filter((h) => !baseKeys.has(keyOf(h)));
    const relevant = fresh.filter((h) => h.action === check.action || h.action === null);
    rows.push({ spec: spec.name, action: check.action, reason: check.reason, existing: check.caughtBy, found: relevant.map((h) => h.kind + (h.field === null ? "" : `(${h.field})`)) });
  }
}

const count = (pred: (r: (typeof rows)[number]) => boolean) => rows.filter(pred).length;
const kinds = [...new Set(rows.flatMap((r) => r.found.map((k) => k.replace(/\(.*\)$/, ""))))];
console.log(JSON.stringify({
  mutants: rows.length,
  equivalentSkipped: equivalent,
  caughtByExisting: count((r) => r.existing.length > 0),
  caughtByNewHints: count((r) => r.found.length > 0),
  caughtByEither: count((r) => r.existing.length > 0 || r.found.length > 0),
  caughtByNeither: rows.filter((r) => r.existing.length === 0 && r.found.length === 0).map((r) => `${r.spec}.${r.action}「${r.reason}」`),
  onlyNewHints: count((r) => r.existing.length === 0 && r.found.length > 0),
  byKind: Object.fromEntries(kinds.map((k) => [k, count((r) => r.found.some((f) => f.startsWith(k)))])),
  falsePositivesOnOriginal: baseline.map((b) => `${b.spec}: ${b.hint.message}`),
  detail: rows.map((r) => `${r.spec}.${r.action}「${r.reason}」 既存=[${r.existing.join(",")}] 新=[${r.found.join(",")}]`),
}, null, 2));
