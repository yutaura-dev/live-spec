import type { ElkNode } from "elkjs/lib/elk-api.js";
import ElkModule from "elkjs/lib/elk.bundled.js";
import type { Graph } from "../model.ts";
import { collapseTransitions, isCollapsed, sourceLabel } from "./collapse.ts";

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface LaidOutNode {
  readonly id: string;
  /** 図に出す名前（入れ子の枠の中では、枠で分かる値を省いたもの） */
  readonly label: string;
  /** 省かない名前 */
  readonly title: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface LaidOutEdge {
  readonly from: string;
  readonly to: string;
  readonly action: string;
  /** この線の操作を実行できる登場人物 */
  readonly actors: ReadonlyArray<string>;
  /** 矢印のラベルに出す文 */
  readonly text: string;
  readonly points: ReadonlyArray<Point>;
  readonly label: Point & { readonly width: number; readonly height: number };
}

export interface LaidOutGroup {
  readonly label: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface Layout {
  readonly width: number;
  readonly height: number;
  readonly groups: ReadonlyArray<LaidOutGroup>;
  readonly nodes: ReadonlyArray<LaidOutNode>;
  readonly edges: ReadonlyArray<LaidOutEdge>;
}

const NODE_HEIGHT = 40;
const NODE_PADDING_X = 28;
const LABEL_HEIGHT = 16;

// ブラウザで文字幅を測らずに概算する理由: 生成は Node で行い、出力を決定的にしたいため。
// 全角は半角の約 2 倍の幅として扱う。
export const textWidth = (text: string, halfWidth = 7.2): number =>
  [...text].reduce((w, ch) => w + ((ch.codePointAt(0) ?? 0) > 0x2e7f ? halfWidth * 1.9 : halfWidth), 0);

const LAYOUT_OPTIONS = {
  "elk.algorithm": "layered",
  "elk.direction": "RIGHT",
  "elk.edgeRouting": "ORTHOGONAL",
  "elk.spacing.nodeNode": "36",
  "elk.layered.spacing.nodeNodeBetweenLayers": "72",
  "elk.spacing.edgeLabel": "4",
  "elk.layered.spacing.edgeNodeBetweenLayers": "24",
  "elk.padding": "[top=24,left=24,bottom=24,right=24]",
  // 入力の並び（幅優先探索の順）をなるべく保つ理由: spec を少し変えただけで図の配置が大きく入れ替わると、
  // 差分レビューで「どこが変わったか」が分からなくなるため。
  "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
  // 循環を断ち切るときに入力順（幅優先探索の順）を基準にする理由: reject や unpublish のような
  // 「戻る」遷移を逆向きの辺として扱わせ、初期状態から右へ流れる読み順を保つため。
  "elk.layered.cycleBreaking.strategy": "MODEL_ORDER",
};

// .default を経由する理由: elkjs は CommonJS で、型定義は `export default` だが実体は module.exports。
// nodenext ではデフォルト import が module.exports そのものの型になり、コンストラクタとして型付けされない。
// 実体は ELKNode.default = ELKNode も設定しているので、.default なら型と実行時の両方で正しく動く。
const ELK = ElkModule.default;

export interface LayoutOptions {
  readonly nodeSize?: { readonly width: number; readonly height: number };
  /** false にすると「どの状態からでも」にまとめない（差分の図で、消えた遷移まで見せるため） */
  readonly collapse?: boolean;
  /** 矢印のラベルに出す操作の名前。既定は関数名 */
  readonly actionLabel?: (action: string) => string;
  /** 状態を入れ子の枠に入れるとき、状態の id から属する枠と短い名前を返す */
  readonly groupOf?: ((id: string) => { readonly key: string; readonly label: string; readonly short: string } | null) | null;
}

const GROUP_PADDING = "[top=30,left=14,bottom=14,right=14]";

export const layout = async (graph: Graph, options: LayoutOptions = {}): Promise<Layout> => {
  const elk = new ELK();
  // 自分自身に戻る遷移は描かない。ほぼすべての状態にあると、図が線で埋まって読めなくなるため。
  const transitions = (options.collapse === false ? graph.transitions : collapseTransitions(graph)).filter((t) => t.from !== t.to);
  const sources = [...new Set(transitions.map((t) => t.from).filter(isCollapsed))];
  const labelOf = options.actionLabel ?? ((action: string) => action);
  const group = (id: string) => options.groupOf?.(id) ?? null;
  // 状態が 1 つしかない値は枠に入れない。枠と箱が二重になるだけで、読み手に何も足さないため。
  const members = new Map<string, Array<string>>();
  for (const s of graph.states) {
    const g = group(s.id);
    if (g !== null) members.set(g.key, [...(members.get(g.key) ?? []), s.id]);
  }
  const boxed = new Map([...members].filter(([, ids]) => ids.length > 1).map(([key, ids], i) => [key, { id: `box${i}`, ids }]));
  const boxOf = (id: string) => {
    const g = group(id);
    return g === null ? undefined : boxed.get(g.key);
  };
  // 名前から値を省くのは、枠に入る状態だけ。枠に入らない状態で省くと、値の違う状態が同じ名前になって見分けられないため。
  const nodeList = [
    ...sources.map((id) => ({ id, label: sourceLabel(graph, id), title: sourceLabel(graph, id), initial: false })),
    ...graph.states.map((s) => ({ id: s.id, label: boxOf(s.id) === undefined ? s.label : group(s.id)!.short, title: s.label, initial: s.initial })),
  ];
  const elkNode = (s: (typeof nodeList)[number]): ElkNode => ({
    id: s.id,
    width: options.nodeSize?.width ?? textWidth(s.label) + NODE_PADDING_X * 2,
    height: options.nodeSize?.height ?? NODE_HEIGHT,
    // 「どの状態からでも」には層の指定をしない。初期状態へ戻る遷移（リセットなど）があると、
    // 初期状態と同じ最初の層に置くことになり、ELK が層の中の辺を扱えずに落ちるため。
    ...(s.initial && boxOf(s.id) === undefined ? { layoutOptions: { "elk.layered.layering.layerConstraint": "FIRST" } } : {}),
  });
  const input: ElkNode = {
    id: "root",
    layoutOptions: {
      ...LAYOUT_OPTIONS,
      ...(boxed.size === 0 ? {} : { "elk.hierarchyHandling": "INCLUDE_CHILDREN", "elk.json.edgeCoords": "ROOT", "elk.json.shapeCoords": "ROOT" }),
    },
    children: [
      ...nodeList.filter((s) => boxOf(s.id) === undefined).map(elkNode),
      ...[...boxed.values()].map((b) => ({
        id: b.id,
        layoutOptions: { "elk.padding": GROUP_PADDING },
        children: nodeList.filter((s) => b.ids.includes(s.id)).map(elkNode),
      })),
    ],
    edges: transitions.map((t, i) => ({
      id: `e${i}`,
      sources: [t.from],
      targets: [t.to],
      labels: [{ text: labelOf(t.action), width: textWidth(labelOf(t.action), 6.6) + 8, height: LABEL_HEIGHT }],
    })),
  };
  const result = await elk.layout(input);

  const flat = (result.children ?? []).flatMap((c) => [c, ...(c.children ?? [])]);
  const nodes = nodeList.map((s) => {
    const n = flat.find((c) => c.id === s.id)!;
    return { id: s.id, label: s.label, title: s.title, x: n.x!, y: n.y!, width: n.width!, height: n.height! };
  });
  const groups = [...boxed].map(([key, b]) => {
    const n = flat.find((c) => c.id === b.id)!;
    return { label: group(b.ids[0]!)!.label, key, x: n.x!, y: n.y!, width: n.width!, height: n.height! };
  });
  const edges = transitions.map((t, i) => {
    const e = result.edges!.find((x) => x.id === `e${i}`)!;
    const section = e.sections![0]!;
    const label = e.labels![0]!;
    return {
      from: t.from,
      to: t.to,
      action: t.action,
      actors: t.actors,
      text: labelOf(t.action),
      points: [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].map(({ x, y }) => ({ x, y })),
      label: { x: label.x!, y: label.y!, width: label.width!, height: label.height! },
    };
  });
  return { width: result.width!, height: result.height!, groups, nodes, edges };
};
