import type { Graph } from "../model.ts";

export const ANY = "*";
export const ANY_LABEL = "どの状態からでも";
const ACTIVE = "*active";
const ACTIVE_LABEL = "終わっていないどの状態からでも";
const MIN_STATES = 3;

/** まとめた線の出どころ（実在の状態ではない）か */
export const isCollapsed = (id: string): boolean => id.startsWith(ANY);

/** 状態の id か、まとめた線の出どころの id を、図や一覧に出す名前にする */
export const sourceLabel = (graph: Graph, id: string): string => {
  if (id === ANY) return ANY_LABEL;
  if (id === ACTIVE) return ACTIVE_LABEL;
  return graph.states.find((s) => s.id === id)?.label ?? id;
};

/** まとめた線の出どころにカーソルを合わせたときに出す、出どころの状態の一覧 */
export const sourceTitle = (graph: Graph, id: string): string => {
  if (!isCollapsed(id)) return sourceLabel(graph, id);
  const members = id === ANY ? graph.states : graph.states.filter((s) => !s.terminal);
  return `${members.map((s) => s.label).join("・")} から`;
};

// すべての状態、または終わっていない状態すべてから同じ行き先に移る線は、1 本にまとめる。保存・リセット・停止のような
// 「いつでもできる」操作は、状態の数だけ線が引かれて図が埋まるため。「どの状態からでも」「終わっていないどの状態からでも」は
// 意味がはっきりしているので、どこから来るのかが図から読める。
// 一部の状態からの線はまとめない。「N つの状態から」の箱は、どの状態から来るのかが図から読めなかったため。
// そうした線は、状態の組ごとに 1 本にまとめて描く（layout）。状態が少ないときはまとめない（かえって分かりにくい）。
export const collapseTransitions = (graph: Graph): Graph["transitions"] => {
  if (graph.states.length < MIN_STATES) return graph.transitions;
  const all = graph.states.map((s) => s.id);
  const active = graph.states.filter((s) => !s.terminal).map((s) => s.id);
  const groups = new Map<string, Array<Graph["transitions"][number]>>();
  for (const t of graph.transitions) {
    const key = JSON.stringify([t.action, t.to]);
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  return [...groups.values()].flatMap((ts) => {
    const to = ts[0]!.to;
    const froms = new Set(ts.filter((t) => t.from !== t.to).map((t) => t.from));
    const merged = (from: string) => [{ from, to, action: ts[0]!.action, actors: [...new Set(ts.flatMap((t) => t.actors))] }];
    if (all.every((id) => id === to || froms.has(id))) return merged(ANY);
    if (froms.size >= MIN_STATES && active.every((id) => id === to || froms.has(id))) return merged(ACTIVE);
    return ts;
  });
};
