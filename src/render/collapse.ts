import type { Graph } from "../model.ts";

export const ANY = "*";
export const ANY_LABEL = "どの状態からでも";
const ACTIVE = "*active";
const ACTIVE_LABEL = "終わっていないどの状態からでも";
const MIN_STATES = 3;
const MIN_SOURCES = 3;

/** まとめた線の出どころ（実在の状態ではない）か */
export const isCollapsed = (id: string): boolean => id.startsWith(ANY);

/** 状態の id か、まとめた線の出どころの id を、図や一覧に出す名前にする */
export const sourceLabel = (graph: Graph, id: string): string => {
  if (id === ANY) return ANY_LABEL;
  if (id === ACTIVE) return ACTIVE_LABEL;
  if (isCollapsed(id)) return `${id.split(":")[1]} つの状態から`;
  return graph.states.find((s) => s.id === id)?.label ?? id;
};

// 同じ操作で同じ行き先に移る線を 1 本にまとめる理由: 保存・リセット・停止のような「いつでもできる」操作は、
// 状態の数だけ線が引かれて図が埋まり、一覧も状態名の羅列になる。ステートチャートで親の状態から
// まとめて書くのと同じく、1 本で表す。すべての状態からなら「どの状態からでも」、終わっていない状態すべてからなら
// 「終わっていないどの状態からでも」、それ以外で 3 本以上なら「N つの状態から」とする。
// 状態が少ないときはまとめない（かえって分かりにくい）。
export const collapseTransitions = (graph: Graph): Graph["transitions"] => {
  if (graph.states.length < MIN_STATES) return graph.transitions;
  const all = graph.states.map((s) => s.id);
  const active = graph.states.filter((s) => !s.terminal).map((s) => s.id);
  const groups = new Map<string, Array<Graph["transitions"][number]>>();
  for (const t of graph.transitions) {
    const key = JSON.stringify([t.action, t.to]);
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  return [...groups.values()].flatMap((ts, i) => {
    const to = ts[0]!.to;
    const froms = new Set(ts.filter((t) => t.from !== t.to).map((t) => t.from));
    const actors = [...new Set(ts.flatMap((t) => t.actors))];
    const merged = (from: string) => [{ from, to, action: ts[0]!.action, actors }];
    if (all.every((id) => id === to || froms.has(id))) return merged(ANY);
    if (froms.size < MIN_SOURCES) return ts;
    if (active.every((id) => id === to || froms.has(id))) return merged(ACTIVE);
    return merged(`${ANY}:${froms.size}:${i}`);
  });
};
