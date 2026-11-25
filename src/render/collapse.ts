import type { Graph } from "../model.ts";

export const ANY = "*";
export const ANY_LABEL = "どの状態からでも";
const MIN_STATES = 3;

// すべての状態から同じ行き先に移る遷移を 1 本にまとめる理由: 保存やリセットのような「いつでもできる」操作は、
// 状態の数だけ線が引かれて図が埋まり、一覧も状態名の羅列になる。ステートチャートで親の状態から
// まとめて書くのと同じく、「どの状態からでも」の 1 本で表す。状態が少ないときはまとめない（かえって分かりにくい）。
export const collapseTransitions = (graph: Graph): Graph["transitions"] => {
  if (graph.states.length < MIN_STATES) return graph.transitions;
  const all = graph.states.map((s) => s.id);
  const groups = new Map<string, Array<Graph["transitions"][number]>>();
  for (const t of graph.transitions) {
    const key = JSON.stringify([t.action, t.to]);
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  return [...groups.values()].flatMap((ts) => {
    const froms = new Set(ts.map((t) => t.from));
    if (!all.every((id) => froms.has(id))) return ts;
    return [{ from: ANY, to: ts[0]!.to, action: ts[0]!.action, actors: [...new Set(ts.flatMap((t) => t.actors))] }];
  });
};
