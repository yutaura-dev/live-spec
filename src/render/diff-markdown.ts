import { groupAvailability, renderDiff, type ModelDiff } from "../diff.ts";
import type { ObjectDiff, ObjectStatus, ProjectDiff } from "../project-diff.ts";
import { edgeLabel, unionGraph } from "./union.ts";

export const STATUS_LABEL: Readonly<Record<ObjectStatus, string>> = {
  added: "追加",
  removed: "削除",
  changed: "変更",
  unchanged: "変化なし",
};

const plusMinus = (d: { readonly added: ReadonlyArray<unknown>; readonly removed: ReadonlyArray<unknown> }) => {
  const parts = [d.added.length > 0 ? `＋${d.added.length}` : "", d.removed.length > 0 ? `－${d.removed.length}` : ""].filter(Boolean);
  return parts.length === 0 ? "" : parts.join(" ");
};

export const summaryOf = (d: ModelDiff) => ({
  actions: plusMinus(d.actions),
  states: plusMinus(d.states),
  transitions: plusMinus(d.transitions),
  availability: (() => {
    const g = groupAvailability(d.availability);
    const reasons = g.reasonOnly.reduce((n, r) => n + r.count, 0);
    return [g.flipped.length > 0 ? `${g.flipped.length} 件` : "", reasons > 0 ? `（理由の言い方 ${reasons} 件）` : ""].join("");
  })(),
  findings: plusMinus(d.findings),
});

// 図の線（遷移）は Mermaid の状態遷移図では色を変えられないので、ラベルに ＋ / － を付けて示す。
const mermaidOf = (o: ObjectDiff): Array<string> => {
  const { nodes, edges } = unionGraph(o.before?.graph ?? null, o.after?.graph ?? null);
  if (nodes.length === 0) return [];
  const mark = { added: " ＋", removed: " －", kept: "", changed: "" } as const;
  return [
    "```mermaid",
    "stateDiagram-v2",
    "  classDef added fill:#d9f7e5,stroke:#1d7f48,color:#0b3d22",
    "  classDef removed fill:#fde2e2,stroke:#b3261e,color:#5c1111,stroke-dasharray:4 3",
    ...nodes.map((n) => `  state "${n.label}" as ${n.id}`),
    ...nodes.filter((n) => n.initial).map((n) => `  [*] --> ${n.id}`),
    ...edges.map((e) => `  ${e.from} --> ${e.to}: ${edgeLabel(e)}${mark[e.status]}`),
    ...nodes.filter((n) => n.status !== "kept").map((n) => `  class ${n.id} ${n.status}`),
    "```",
  ];
};

export const renderDiffMarkdown = (p: ProjectDiff): string => {
  const changed = p.objects.filter((o) => o.status !== "unchanged");
  const unchanged = p.objects.filter((o) => o.status === "unchanged");
  return [
    "# 仕様の差分",
    "",
    `\`${p.base}\` → \`${p.head}\``,
    "",
    ...(changed.length === 0
      ? ["仕様の変化はありません。", ""]
      : [
          "| ドメインオブジェクト | 変化 | 操作 | 状態 | 遷移 | できる／できない | 検査結果 |",
          "|---|---|---|---|---|---|---|",
          ...changed.map((o) => {
            const s = summaryOf(o.diff);
            return `| [${o.name}](#${o.name}) | ${STATUS_LABEL[o.status]} | ${s.actions} | ${s.states} | ${s.transitions} | ${s.availability} | ${s.findings} |`;
          }),
          "",
        ]),
    ...(unchanged.length === 0 ? [] : [`変化なし: ${unchanged.map((o) => o.name).join(", ")}`, ""]),
    ...changed.flatMap((o) => [
      `## ${o.name}（${STATUS_LABEL[o.status]}）`,
      "",
      ...mermaidOf(o),
      "",
      renderDiff(o.diff, { heading: false }),
    ]),
  ].join("\n");
};
