import { diffModels, groupAvailability } from "./diff.ts";
import { ensureScope } from "./ensure-scope.ts";
import { explore } from "./explore.ts";
import type { Spec } from "./load.ts";
import { normalize, type EnsureCheck, type Graph } from "./model.ts";

const caughtLabel = (f: Readonly<Record<string, unknown>>): string => {
  switch (f.kind) {
    case "invariant-violation":
      return `不変条件「${String(f.invariant)}」`;
    case "scenario-failed":
      return `シナリオ「${String(f.scenario)}」`;
    case "surface-action-missing":
    case "surface-action-not-allowed":
      return "画面のボタン";
    case "action-error":
    case "invalid-return":
      return "実行時エラー";
    case "state-limit":
      return "状態の数の上限";
    default:
      return String(f.kind);
  }
};

// 静的解析で読めなかったとき（ソースがない spec）は、探索で実際に止めた理由から外す対象を決める。
// この場合、一度も止めなかった ensure は対象にできない。
const targetsOf = (spec: Spec, graph: Graph) =>
  spec.actions.flatMap(([action]) => {
    const found = spec.ensures[action];
    if (found !== undefined) return found.map((e) => ({ action, reason: e.reason, line: e.line as number | null, narrowing: e.narrowing === true }));
    const reasons = [...new Set(graph.availability.filter((a) => a.action === action && a.reason !== null).map((a) => a.reason!))];
    return reasons.map((reason) => ({ action, reason, line: null, narrowing: false }));
  });

export const checkEnsures = (spec: Spec, graph: Graph): Array<EnsureCheck> => {
  const original = normalize(spec, graph);
  const seen = new Set<string>();
  return targetsOf(spec, graph).flatMap((target) => {
    // 同じ操作に同じ理由の ensure が 2 つあると、外すときに区別できないので 1 回だけ調べる。
    const key = JSON.stringify([target.action, target.reason]);
    if (seen.has(key)) return [];
    seen.add(key);
    const mutant = explore(spec, { bypassEnsure: target });
    const d = diffModels(original, normalize(spec, mutant));
    const effects = groupAvailability(d.availability)
      .flipped.filter((a) => a.after.startsWith("✅"))
      .map((a) => ({ state: a.state, action: a.action, actor: a.actor, input: a.input, after: a.after }));
    const caughtBy = [...new Set(d.findings.added.map((f) => caughtLabel(f as Readonly<Record<string, unknown>>)))];
    const changed = effects.length + d.states.added.length + d.transitions.added.length > 0;
    const verdict = caughtBy.length > 0 ? "caught" : changed ? "unguarded" : "no-effect";
    return [{ ...target, verdict, caughtBy, effects, newStates: d.states.added, passes: ensureScope(spec, graph, target.action, target.reason).passes }];
  });
};
