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
const membersOf = (graph: Graph, id: string): Array<string> =>
  id === ANY ? graph.states.map((s) => s.id) : id === ACTIVE ? graph.states.filter((s) => !s.terminal).map((s) => s.id) : (JSON.parse(id.slice(ANY.length + 1)) as Array<string>);
const namesOf = (graph: Graph, ids: ReadonlyArray<string>) =>
  graph.states
    .filter((s) => ids.includes(s.id))
    .map((s) => s.label)
    .join("・");

// 出どころの状態の名前を書く。「N つの状態から」だけでは、どこから来るのかが図から読めないため。
// 除いた状態のほうが少なければ「〜以外から」と書く。短くなるうえ、「処理中からは移せない」のような決まりがそのまま読める。
export const sourceLabel = (graph: Graph, id: string): string => {
  if (id === ANY) return ANY_LABEL;
  if (id === ACTIVE) return ACTIVE_LABEL;
  if (!isCollapsed(id)) return graph.states.find((s) => s.id === id)?.label ?? id;
  const members = membersOf(graph, id);
  const others = graph.states.map((s) => s.id).filter((s) => !members.includes(s));
  return others.length < members.length ? `${namesOf(graph, others)} 以外から` : `${namesOf(graph, members)} から`;
};

/** まとめた線の出どころにカーソルを合わせたときに出す、出どころの状態の一覧 */
export const sourceTitle = (graph: Graph, id: string): string =>
  isCollapsed(id) ? `${namesOf(graph, membersOf(graph, id))} から` : sourceLabel(graph, id);

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
  // 出どころの組み合わせが同じなら、行き先が違っても同じ「N つの状態から」の箱にする。列をどこへでも移せる操作で、
  // 行き先の数だけ箱が並ぶのを防ぐため。行き先そのものも組み合わせに含めて比べる（自分の列へ移すのは自分に戻る線で、
  // 図には描かないので、それを除くと行き先ごとに組み合わせが変わってしまう）。
  return [...groups.values()].flatMap((ts) => {
    const to = ts[0]!.to;
    const froms = new Set(ts.filter((t) => t.from !== t.to).map((t) => t.from));
    const key = JSON.stringify([...new Set([...froms, to])].sort());
    const actors = [...new Set(ts.flatMap((t) => t.actors))];
    const merged = (from: string) => [{ from, to, action: ts[0]!.action, actors }];
    if (all.every((id) => id === to || froms.has(id))) return merged(ANY);
    if (froms.size < MIN_SOURCES) return ts;
    if (active.every((id) => id === to || froms.has(id))) return merged(ACTIVE);
    return merged(`${ANY}:${key}`);
  });
};
