import type { Spec } from "../load.ts";
import { fieldLabel } from "../labels.ts";
import type { Graph } from "../model.ts";

export const groupField = (spec: Spec): string | null => {
  const initial = spec.initial as Readonly<Record<string, unknown>>;
  if (spec.groupBy !== null && spec.groupBy in initial) return spec.groupBy;
  return Object.keys(initial).find((k) => typeof initial[k] === "string") ?? null;
};

export const groupValueLabel = (spec: Spec, field: string, value: unknown): string =>
  typeof value === "string" ? value : value === true ? fieldLabel(spec, field) : value === false ? `${fieldLabel(spec, field)}でない` : JSON.stringify(value);

// 状態を 1 つの項目の値でまとめた図を作る理由: 状態は項目の値の組なので、項目が増えると状態と線が掛け算で増え、
// 主な流れが追えなくなる。モデルから項目を外すと検査（袋小路など）も弱くなるので、見せ方だけをまとめる。
// まとめても状態が減らない（どの値も状態 1 つだけ）なら、要約の図は出さない。
export const summaryGraph = (spec: Spec, graph: Graph): Graph | null => {
  const field = groupField(spec);
  if (field === null) return null;
  const keyOf = (id: string) => JSON.stringify(graph.states.find((s) => s.id === id)?.values[field]);
  const keys = [...new Set(graph.states.map((s) => JSON.stringify(s.values[field])))];
  if (keys.length < 2 || keys.length >= graph.states.length) return null;
  const idOf = (key: string) => `group:${keys.indexOf(key)}`;
  const states = keys.map((key) => {
    const members = graph.states.filter((s) => JSON.stringify(s.values[field]) === key);
    const value = JSON.parse(key) as unknown;
    return {
      id: idOf(key),
      label: groupValueLabel(spec, field, value),
      values: { [field]: value },
      initial: members.some((s) => s.initial),
      terminal: members.every((s) => s.terminal),
    };
  });
  const transitions = new Map<string, Graph["transitions"][number]>();
  for (const t of graph.transitions) {
    const from = idOf(keyOf(t.from));
    const to = idOf(keyOf(t.to));
    if (from === to) continue;
    const k = JSON.stringify([from, t.action, to]);
    const prev = transitions.get(k);
    transitions.set(k, { from, to, action: t.action, actors: [...new Set([...(prev?.actors ?? []), ...t.actors])] });
  }
  return { ...graph, states, transitions: [...transitions.values()] };
};

/** 詳細の図の入れ子の枠: 状態の id から、属する枠と、枠で分かる値を省いた短い名前を返す */
export const detailGroups = (spec: Spec, graph: Graph) => {
  const field = groupField(spec);
  if (field === null || summaryGraph(spec, graph) === null) return null;
  return (id: string): { readonly key: string; readonly label: string; readonly short: string } | null => {
    const s = graph.states.find((x) => x.id === id);
    if (s === undefined) return null;
    const label = groupValueLabel(spec, field, s.values[field]);
    const rest = s.label.split(" · ").filter((part) => part !== label);
    return { key: JSON.stringify(s.values[field]), label, short: rest.length === 0 ? label : rest.join(" · ") };
  };
};
