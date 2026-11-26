import type { Spec } from "../load.ts";
import { fieldLabel } from "../labels.ts";
import type { Graph } from "../model.ts";
import { ANY, ANY_LABEL, collapseTransitions, isCollapsed, sourceLabel } from "./collapse.ts";

export interface ActionSummary {
  readonly name: string;
  readonly summary: string | null;
  readonly capable: ReadonlyArray<string>;
  readonly othersReasons: ReadonlyArray<string>;
  readonly when: ReadonlyArray<{ readonly from: string; readonly to: string }>;
  readonly blocked: ReadonlyArray<{ readonly reason: string; readonly states: ReadonlyArray<string> }>;
  /** partial: その操作で変わらない場合もある項目 */
  readonly effect: ReadonlyArray<{ readonly field: string; readonly values: ReadonlyArray<string>; readonly partial: boolean }>;
  readonly inputReasons: ReadonlyArray<{ readonly input: string; readonly reason: string }>;
  readonly inputOutcomes: ReadonlyArray<{
    readonly input: string;
    readonly transitions: ReadonlyArray<{ readonly from: string; readonly to: string }>;
    readonly reasons: ReadonlyArray<string>;
  }>;
}

export interface StateSummary {
  readonly id: string;
  readonly label: string;
  readonly initial: boolean;
  readonly terminal: boolean;
  readonly can: ReadonlyArray<{ readonly action: string; readonly actors: ReadonlyArray<string>; readonly to: string }>;
  readonly cannot: ReadonlyArray<{ readonly action: string; readonly reason: string }>;
  readonly violations: ReadonlyArray<string>;
  readonly surfaces: ReadonlyArray<{ readonly actors: ReadonlyArray<string>; readonly surface: unknown }>;
}

const ERROR_REASON = "エラー";

// 「担当者」= どこかの状態で一度でもその操作を実行できた登場人物。
// 担当者が止められた理由を「いつ」の条件、担当者以外が止められた理由を「誰が」の条件とみなす。
// spec の書き手に ensure を「権限」「状態」と分類させずに、実行結果だけから両者を分けるため。
// 担当者がいない操作では、全員の理由を「いつ」の条件として扱う。
const capableOf = (graph: Graph, action: string) =>
  unique(graph.availability.filter((a) => a.action === action && a.enabled).map((a) => a.actor));

const whenReason = (graph: Graph, state: string, action: string, capable: ReadonlyArray<string>) => {
  const entries = graph.availability.filter(
    (a) => a.state === state && a.action === action && (capable.length === 0 || capable.includes(a.actor)),
  );
  return unique(entries.map((a) => a.reason ?? ERROR_REASON)).join("、");
};

export const summarizeActions = (spec: Spec, graph: Graph): ReadonlyArray<ActionSummary> => {
  const labelOf = labeler(graph);
  return spec.actions.map(([name]) => {
    const entries = graph.availability.filter((a) => a.action === name);
    const capable = capableOf(graph, name);
    const blocked = new Map<string, Array<string>>();
    for (const state of unique(entries.map((a) => a.state))) {
      if (entries.some((a) => a.state === state && a.enabled)) continue;
      const reason = whenReason(graph, state, name, capable);
      blocked.set(reason, [...(blocked.get(reason) ?? []), labelOf(state)]);
    }
    return {
      name,
      summary: spec.docs[name] ?? null,
      capable,
      othersReasons:
        capable.length === 0 ? [] : unique(entries.filter((a) => !capable.includes(a.actor)).map((a) => a.reason ?? ERROR_REASON)),
      when: uniqueBy(
        collapseTransitions(graph)
          .filter((t) => t.action === name)
          .map((t) => ({ from: t.from === ANY ? ANY : isCollapsed(t.from) ? sourceLabel(graph, t.from) : labelOf(t.from), to: labelOf(t.to) })),
        (w) => `${w.from}→${w.to}`,
      ),
      blocked: [...blocked.entries()].map(([reason, states]) => ({ reason, states })),
      effect: effectOf(graph, name).map((e) => ({ ...e, field: fieldLabel(spec, e.field) })),
      inputReasons: inputReasonsOf(entries),
      inputOutcomes: inputOutcomesOf(spec, name, entries, labelOf),
    };
  });
};

export const summarizeStates = (spec: Spec, graph: Graph): ReadonlyArray<StateSummary> => {
  const labelOf = labeler(graph);
  return graph.states.map((s) => {
    const can: Array<StateSummary["can"][number]> = [];
    const cannot: Array<StateSummary["cannot"][number]> = [];
    for (const [action] of spec.actions) {
      const enabled = graph.availability.filter((a) => a.state === s.id && a.action === action && a.enabled);
      if (enabled.length > 0) {
        for (const to of unique(enabled.map((a) => a.to!))) {
          can.push({ action, actors: unique(enabled.filter((a) => a.to === to).map((a) => a.actor)), to: labelOf(to) });
        }
      } else if (graph.availability.some((a) => a.state === s.id && a.action === action)) {
        cannot.push({ action, reason: whenReason(graph, s.id, action, capableOf(graph, action)) });
      }
    }
    const violations = graph.findings.flatMap((f) => (f.kind === "invariant-violation" && f.state === s.id ? [f.invariant] : []));
    const groups = new Map<string, { actors: Array<string>; surface: unknown }>();
    for (const sf of graph.surfaces.filter((x) => x.state === s.id)) {
      const key = JSON.stringify(sf.surface);
      const g = groups.get(key) ?? { actors: [], surface: sf.surface };
      g.actors.push(sf.actor);
      groups.set(key, g);
    }
    return { id: s.id, label: s.label, initial: s.initial, terminal: s.terminal, can, cannot, violations, surfaces: [...groups.values()] };
  });
};

// 同じ状態・同じ登場人物で、ある入力では成功し別の入力では失敗したときだけ、その失敗を
// 「入力の条件」とみなす。状態や権限による失敗と混ぜないため。
const inputReasonsOf = (entries: Graph["availability"]): ActionSummary["inputReasons"] => {
  const found = entries.filter(
    (a) =>
      !a.enabled &&
      a.input !== null &&
      entries.some((b) => b.enabled && b.state === a.state && b.actor === a.actor),
  );
  return uniqueBy(
    found.map((a) => ({ input: a.input!, reason: a.reason ?? ERROR_REASON })),
    (r) => `${r.input}|${r.reason}`,
  );
};

// 入力ごとに「どこからどこへ移るか」を出す理由: CLI の引数のように入力で結果が大きく変わる操作では、
// 「できない入力」だけでは、正しい入力でどうなるかが仕様書から読めないため。
const inputOutcomesOf = (
  spec: Spec,
  action: string,
  entries: Graph["availability"],
  labelOf: (id: string) => string,
): ActionSummary["inputOutcomes"] =>
  (spec.inputs[action] ?? []).map(([input]) => {
    const mine = entries.filter((a) => a.input === input);
    const transitions = uniqueBy(
      mine.filter((a) => a.enabled).map((a) => ({ from: labelOf(a.state), to: labelOf(a.to!) })),
      (t) => `${t.from}→${t.to}`,
    );
    if (transitions.length > 0) return { input, transitions, reasons: [] };
    // 入力が原因の理由を優先する理由: 全員が状態や権限で止まる理由まで並べると、その入力の何がだめなのかが埋もれるため。
    const byInput = inputReasonsOf(entries).filter((r) => r.input === input).map((r) => r.reason);
    const reasons = byInput.length > 0 ? byInput : unique(mine.map((a) => a.reason ?? ERROR_REASON));
    return { input, transitions, reasons };
  });

const REST_THRESHOLD = 3;

// 一番多いまとまりを「それ以外」とまとめる理由: できないときの状態は、たいてい「できるとき」の補集合で、
// すべて並べると状態名の壁になり、何が条件なのかが読めなくなるため。少ないときはそのまま並べる。
export const presentBlocked = (
  blocked: ActionSummary["blocked"],
): ReadonlyArray<{ readonly reason: string; readonly states: ReadonlyArray<string> | null }> => {
  if (blocked.length === 0) return [];
  const largest = blocked.reduce((a, b) => (b.states.length > a.states.length ? b : a));
  if (largest.states.length < REST_THRESHOLD) return blocked;
  return [...blocked.filter((b) => b !== largest), { reason: largest.reason, states: null }];
};

export const formatTransition = (t: { readonly from: string; readonly to: string }) =>
  t.from === ANY ? `${ANY_LABEL} → ${t.to}` : t.from === t.to ? `${t.from}（変わらない）` : `${t.from} → ${t.to}`;

const effectOf = (graph: Graph, action: string): ActionSummary["effect"] => {
  const changed = new Map<string, Set<string>>();
  const mine = graph.transitions.filter((t) => t.action === action);
  const changes = new Map<string, number>();
  for (const t of mine) {
    const from = graph.states.find((s) => s.id === t.from)!.values;
    const to = graph.states.find((s) => s.id === t.to)!.values;
    for (const k of Object.keys(to)) {
      if (JSON.stringify(from[k]) === JSON.stringify(to[k])) continue;
      if (!changed.has(k)) changed.set(k, new Set());
      changes.set(k, (changes.get(k) ?? 0) + 1);
      changed.get(k)!.add(typeof to[k] === "string" ? (to[k] as string) : JSON.stringify(to[k]));
    }
  }
  return [...changed.entries()].map(([field, values]) => ({ field, values: [...values], partial: changes.get(field)! < mine.length }));
};

const labeler = (graph: Graph) => (id: string) => graph.states.find((s) => s.id === id)?.label ?? id;
const unique = <A>(xs: ReadonlyArray<A>): Array<A> => [...new Set(xs)];
const uniqueBy = <A>(xs: ReadonlyArray<A>, key: (a: A) => string): Array<A> => [
  ...new Map(xs.map((x) => [key(x), x])).values(),
];
