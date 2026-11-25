import type { Spec } from "../load.ts";
import type { Finding, Graph } from "../model.ts";
import { summarizeActions, type ActionSummary } from "./summary.ts";

export const renderMarkdown = (spec: Spec, graph: Graph): string => {
  const labelOf = (id: string) => graph.states.find((s) => s.id === id)?.label ?? id;
  return [
    `# ${spec.name}`,
    "",
    ...(spec.stateDoc === null ? [] : [spec.stateDoc, ""]),
    "## 状態遷移図",
    "",
    "```mermaid",
    "stateDiagram-v2",
    ...graph.states.map((s) => `  state "${s.label}" as ${s.id}`),
    ...graph.states.filter((s) => s.initial).map((s) => `  [*] --> ${s.id}`),
    ...graph.transitions.map((t) => `  ${t.from} --> ${t.to}: ${t.action} (${t.actors.join(", ")})`),
    ...graph.states.filter((s) => s.terminal).map((s) => `  ${s.id} --> [*]`),
    "```",
    "",
    "## 操作",
    "",
    ...summarizeActions(spec, graph).flatMap((a) => [...actionSection(a), ""]),
    "## 検査結果",
    "",
    ...(graph.findings.length === 0 ? ["問題は見つかりませんでした。"] : graph.findings.map((f) => `- ⚠ ${describeFinding(f, labelOf)}`)),
    "",
  ].join("\n");
};

const actionSection = (a: ActionSummary): Array<string> => {
  const heading = a.summary === null ? `### \`${a.name}\`` : `### ${a.summary}（\`${a.name}\`）`;
  if (a.capable.length === 0) return [heading, "", "- **できる人**: なし（どの状態でも誰も実行できない）"];
  const who =
    a.othersReasons.length === 0 ? a.capable.join(", ") : `${a.capable.join(", ")}（ほかの人は「${a.othersReasons.join("」「")}」）`;
  const groups = a.blocked.map((b) => `${b.states.join(", ")}（${b.reason}）`);
  const whenNot =
    groups.length === 0
      ? "- **できないとき**: なし"
      : groups.length === 1
        ? `- **できないとき**: ${groups[0]}`
        : ["- **できないとき**:", ...groups.map((g) => `  - ${g}`)].join("\n");
  const effect = formatEffect(a);
  return [
    heading,
    "",
    `- **できる人**: ${who}`,
    `- **できるとき**: ${a.when.map((w) => `${w.from} → ${w.to}`).join(" / ")}`,
    whenNot,
    ...(a.inputReasons.length === 0
      ? []
      : [`- **できない入力**: ${a.inputReasons.map((r) => `${r.input}（${r.reason}）`).join("、")}`]),
    ...(effect === "" ? [] : [`- **結果**: ${effect}`]),
  ];
};

export const formatEffect = (a: ActionSummary) => a.effect.map((e) => `${e.field} → ${e.values.join(" / ")}`).join(", ");

export const describeFinding = (f: Finding, labelOf: (id: string) => string): string => {
  switch (f.kind) {
    case "unreachable-value":
      return `${f.field} = ${String(f.value)} は型に書かれているが、到達できるどの状態でもとらない`;
    case "never-enabled-action":
      return `操作 ${f.action} は、到達できるどの状態でも誰も実行できない`;
    case "action-error":
      return `操作 ${f.action} が ${labelOf(f.state)} で ${f.actor} が実行したときに例外を投げた: ${f.message}`;
    case "invalid-return":
      return `操作 ${f.action} が ${labelOf(f.state)} で ${f.actor} が実行したときにオブジェクトを返さなかった`;
    case "invariant-violation": {
      const path = f.path.length === 0 ? "初期状態" : f.path.map((p) => `${p.action} (${p.actor})`).join(" → ");
      return `不変条件「${f.invariant}」を ${labelOf(f.state)} で破る（${path}）`;
    }
    case "missing-inputs":
      return `操作 ${f.action} は 3 つ目以降の引数をとるが、inputs に例がないので実行していない`;
    case "unknown-inputs":
      return `inputs に書かれた ${f.action} という操作は存在しない`;
    case "surface-action-not-allowed":
      return `${labelOf(f.state)} で ${f.actor} に ${f.action} のボタンが見えているが、実行できない`;
    case "surface-action-missing":
      return `${labelOf(f.state)} で ${f.actor} は ${f.action} を実行できるが、画面にボタンがない`;
    case "surface-error":
      return `${labelOf(f.state)} で ${f.actor} の画面を作るときに例外を投げた: ${f.message}`;
    case "state-limit":
      return `状態が ${f.maxStates} 個を超えたので探索を打ち切った（値が増え続ける項目がないか確認する）`;
  }
};
