import type { Graph } from "../model.ts";

export type DiffStatus = "added" | "removed" | "kept";
export type EdgeStatus = DiffStatus | "changed";

export interface UnionNode {
  readonly id: string;
  readonly label: string;
  readonly status: DiffStatus;
  readonly initial: boolean;
}

export interface UnionEdge {
  readonly from: string;
  readonly to: string;
  readonly action: string;
  /** changed は、遷移はあるが通れる人が変わったもの */
  readonly status: EdgeStatus;
  readonly actorsAdded: ReadonlyArray<string>;
  readonly actorsRemoved: ReadonlyArray<string>;
}

// 状態は値で突き合わせる（ID は探索順で、名前は initial の書き順で変わりうる）。
// 自分自身に戻る遷移は、通常の図と同じく描かない。
export const unionGraph = (before: Graph | null, after: Graph | null) => {
  const keyOf = (s: Graph["states"][number]) => JSON.stringify(s.values);
  const labelsOf = (g: Graph | null) => new Map((g?.states ?? []).map((s) => [s.id, keyOf(s)]));
  const lb = labelsOf(before);
  const la = labelsOf(after);
  const beforeKeys = new Set(lb.values());
  const afterKeys = new Set(la.values());
  const ordered = [...new Set([...afterKeys, ...beforeKeys])];
  // 変更後の名前を優先する理由: レビューする人が読むのは変更後の spec なので。
  const names = new Map([...(before?.states ?? []), ...(after?.states ?? [])].map((s) => [keyOf(s), s.label]));
  const initialState = (after ?? before)?.states.find((s) => s.initial);
  const initialKey = initialState === undefined ? undefined : keyOf(initialState);
  const nodes: Array<UnionNode> = ordered.map((key, i) => ({
    id: `n${i}`,
    label: names.get(key) ?? key,
    status: !beforeKeys.has(key) ? "added" : !afterKeys.has(key) ? "removed" : "kept",
    initial: key === initialKey,
  }));
  const idOf = new Map(ordered.map((key, i) => [key, nodes[i]!.id]));
  const actorsByKey = (g: Graph | null, labels: Map<string, string>) => {
    const map = new Map<string, Set<string>>();
    for (const t of (g?.transitions ?? []).filter((t) => t.from !== t.to)) {
      const key = JSON.stringify([labels.get(t.from), t.action, labels.get(t.to)]);
      map.set(key, new Set([...(map.get(key) ?? []), ...t.actors]));
    }
    return map;
  };
  const kb = actorsByKey(before, lb);
  const ka = actorsByKey(after, la);
  const edges: Array<UnionEdge> = [...new Set([...ka.keys(), ...kb.keys()])].map((key) => {
    const [from, action, to] = JSON.parse(key) as [string, string, string];
    const b = kb.get(key);
    const a = ka.get(key);
    const actorsAdded = b === undefined || a === undefined ? [] : [...a].filter((x) => !b.has(x));
    const actorsRemoved = b === undefined || a === undefined ? [] : [...b].filter((x) => !a.has(x));
    const status: EdgeStatus =
      b === undefined ? "added" : a === undefined ? "removed" : actorsAdded.length + actorsRemoved.length > 0 ? "changed" : "kept";
    return { from: idOf.get(from)!, to: idOf.get(to)!, action, status, actorsAdded, actorsRemoved };
  });
  return { nodes, edges };
};

export const edgeLabel = (e: UnionEdge): string =>
  [e.action, ...e.actorsAdded.map((a) => `＋${a}`), ...e.actorsRemoved.map((a) => `－${a}`)].join(" ");
