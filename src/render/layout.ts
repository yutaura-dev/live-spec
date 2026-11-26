import type { ElkNode } from "elkjs/lib/elk-api.js";
import ElkModule from "elkjs/lib/elk.bundled.js";
import type { Graph } from "../model.ts";
import { ANY, ANY_LABEL, collapseTransitions } from "./collapse.ts";

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface LaidOutNode {
  readonly id: string;
  readonly label: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface LaidOutEdge {
  readonly from: string;
  readonly to: string;
  readonly action: string;
  /** 矢印のラベルに出す文 */
  readonly text: string;
  readonly points: ReadonlyArray<Point>;
  readonly label: Point & { readonly width: number; readonly height: number };
}

export interface Layout {
  readonly width: number;
  readonly height: number;
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
}

export const layout = async (graph: Graph, options: LayoutOptions = {}): Promise<Layout> => {
  const elk = new ELK();
  // 自分自身に戻る遷移は描かない。ほぼすべての状態にあると、図が線で埋まって読めなくなるため。
  const transitions = (options.collapse === false ? graph.transitions : collapseTransitions(graph)).filter((t) => t.from !== t.to);
  const hasAny = transitions.some((t) => t.from === ANY);
  const labelOf = options.actionLabel ?? ((action: string) => action);
  const nodeList = [
    ...(hasAny ? [{ id: ANY, label: ANY_LABEL, initial: false }] : []),
    ...graph.states.map((s) => ({ id: s.id, label: s.label, initial: s.initial })),
  ];
  const input: ElkNode = {
    id: "root",
    layoutOptions: LAYOUT_OPTIONS,
    children: nodeList.map((s) => ({
      id: s.id,
      width: options.nodeSize?.width ?? textWidth(s.label) + NODE_PADDING_X * 2,
      height: options.nodeSize?.height ?? NODE_HEIGHT,
      // 「どの状態からでも」には層の指定をしない。初期状態へ戻る遷移（リセットなど）があると、
      // 初期状態と同じ最初の層に置くことになり、ELK が層の中の辺を扱えずに落ちるため。
      ...(s.initial ? { layoutOptions: { "elk.layered.layering.layerConstraint": "FIRST" } } : {}),
    })),
    edges: transitions.map((t, i) => ({
      id: `e${i}`,
      sources: [t.from],
      targets: [t.to],
      labels: [{ text: labelOf(t.action), width: textWidth(labelOf(t.action), 6.6) + 8, height: LABEL_HEIGHT }],
    })),
  };
  const result = await elk.layout(input);

  const nodes = nodeList.map((s) => {
    const n = result.children!.find((c) => c.id === s.id)!;
    return { id: s.id, label: s.label, x: n.x!, y: n.y!, width: n.width!, height: n.height! };
  });
  const edges = transitions.map((t, i) => {
    const e = result.edges!.find((x) => x.id === `e${i}`)!;
    const section = e.sections![0]!;
    const label = e.labels![0]!;
    return {
      from: t.from,
      to: t.to,
      action: t.action,
      text: labelOf(t.action),
      points: [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].map(({ x, y }) => ({ x, y })),
      label: { x: label.x!, y: label.y!, width: label.width!, height: label.height! },
    };
  });
  return { width: result.width!, height: result.height!, nodes, edges };
};
