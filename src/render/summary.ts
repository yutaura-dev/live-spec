import type { Spec } from "../load.ts";
import type { Graph } from "../model.ts";

export interface ActionSummary {
  readonly name: string;
  readonly summary: string | null;
  readonly capable: ReadonlyArray<string>;
  readonly othersReasons: ReadonlyArray<string>;
  readonly when: ReadonlyArray<{ readonly from: string; readonly to: string }>;
  readonly blocked: ReadonlyArray<{ readonly reason: string; readonly states: ReadonlyArray<string> }>;
  readonly effect: ReadonlyArray<{ readonly field: string; readonly values: ReadonlyArray<string> }>;
}

export interface StateSummary {
  readonly id: string;
  readonly label: string;
  readonly initial: boolean;
  readonly terminal: boolean;
  readonly can: ReadonlyArray<{ readonly action: string; readonly actors: ReadonlyArray<string>; readonly to: string }>;
  readonly cannot: ReadonlyArray<{ readonly action: string; readonly reason: string }>;
  readonly violations: ReadonlyArray<string>;
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
        graph.transitions.filter((t) => t.action === name).map((t) => ({ from: labelOf(t.from), to: labelOf(t.to) })),
        (w) => `${w.from}→${w.to}`,
      ),
      blocked: [...blocked.entries()].map(([reason, states]) => ({ reason, states })),
      effect: effectOf(graph, name),
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
          can.push({ action, actors: enabled.filter((a) => a.to === to).map((a) => a.actor), to: labelOf(to) });
        }
      } else if (graph.availability.some((a) => a.state === s.id && a.action === action)) {
        cannot.push({ action, reason: whenReason(graph, s.id, action, capableOf(graph, action)) });
      }
    }
    const violations = graph.findings.flatMap((f) => (f.kind === "invariant-violation" && f.state === s.id ? [f.invariant] : []));
    return { id: s.id, label: s.label, initial: s.initial, terminal: s.terminal, can, cannot, violations };
  });
};

const effectOf = (graph: Graph, action: string): ActionSummary["effect"] => {
  const changed = new Map<string, Set<string>>();
  for (const t of graph.transitions) {
    if (t.action !== action) continue;
    const from = graph.states.find((s) => s.id === t.from)!.values;
    const to = graph.states.find((s) => s.id === t.to)!.values;
    for (const k of Object.keys(to)) {
      if (JSON.stringify(from[k]) === JSON.stringify(to[k])) continue;
      if (!changed.has(k)) changed.set(k, new Set());
      changed.get(k)!.add(typeof to[k] === "string" ? (to[k] as string) : JSON.stringify(to[k]));
    }
  }
  return [...changed.entries()].map(([field, values]) => ({ field, values: [...values] }));
};

const labeler = (graph: Graph) => (id: string) => graph.states.find((s) => s.id === id)?.label ?? id;
const unique = <A>(xs: ReadonlyArray<A>): Array<A> => [...new Set(xs)];
const uniqueBy = <A>(xs: ReadonlyArray<A>, key: (a: A) => string): Array<A> => [
  ...new Map(xs.map((x) => [key(x), x])).values(),
];
