import type { Spec } from "../load.ts";
import type { Finding, Graph } from "../model.ts";
import { ANY, ANY_LABEL, collapseTransitions } from "./collapse.ts";
import { formatTransition, presentBlocked, summarizeActions, type ActionSummary } from "./summary.ts";

type Objects = ReadonlyArray<{ readonly spec: Spec; readonly graph: Graph }>;

const actionName = (objects: Objects, object: string, action: string) => {
  const spec = objects.find((o) => o.spec.name === object)?.spec;
  const doc = spec?.docs[action];
  return doc === undefined ? action : `${doc.replace(/。$/, "")}（${action}）`;
};

const endpoint = (objects: Objects, object: string, action: string | null) =>
  `[${object}](${object}.md)${action === null ? "" : ` の ${actionName(objects, object, action)}`}`;

const allLinks = (objects: Objects) =>
  objects.flatMap(({ spec, graph }) => graph.links.map((l) => ({ ...l, source: spec.name })));

export const renderIndexMarkdown = (objects: Objects, title: string): string =>
  [
    `# ${title}`,
    "",
    `ドメインオブジェクト ${objects.length} 個の仕様書です。`,
    "",
    "| ドメインオブジェクト | 説明 | 状態 | 操作 | 未決 | 検査 |",
    "|---|---|---|---|---|---|",
    ...objects.map(
      ({ spec, graph }) =>
        `| [${spec.name}](${spec.name}.md) | ${spec.stateDoc ?? ""} | ${graph.states.length} | ${spec.actions.length} | ${graph.questions.length} | ${graph.findings.length === 0 ? "OK" : `⚠ ${graph.findings.length}`} |`,
    ),
    "",
    ...(allLinks(objects).length === 0
      ? []
      : [
          "## つながり",
          "",
          ...allLinks(objects).map(
            (l) => `- ${endpoint(objects, l.source, l.from)} → ${endpoint(objects, l.to, l.action)}: ${l.label}`,
          ),
          "",
        ]),
  ].join("\n");

export const renderMarkdown = (spec: Spec, graph: Graph, objects: Objects = [{ spec, graph }]): string => {
  const incoming = allLinks(objects).filter((l) => l.to === spec.name && l.source !== spec.name);
  const ownAction = (action: string | null) => (action === null ? "" : actionName(objects, spec.name, action));
  const labelOf = (id: string) => graph.states.find((s) => s.id === id)?.label ?? id;
  return [
    `# ${spec.name}`,
    "",
    ...(spec.stateDoc === null ? [] : [spec.stateDoc, ""]),
    // 未決事項を状態遷移図より前に置く理由: AI が書いた仕様のうち、人が判断すべきなのはここだけ、という
    // 入口にしたいため。全体を読む前に、判断が必要な点が目に入るようにする。
    ...(graph.questions.length === 0
      ? []
      : [
          "## 未決事項",
          "",
          ...graph.questions.flatMap((q, i) => [
            `${i + 1}. ${q.ask}${questionTarget(spec, q, labelOf)}`,
            ...(q.note === null ? [] : [`   - ${q.note}`]),
          ]),
          "",
        ]),
    "## 状態遷移図",
    "",
    "```mermaid",
    "stateDiagram-v2",
    ...graph.states.map((s) => `  state "${s.label}" as ${s.id}`),
    ...graph.states.filter((s) => s.initial).map((s) => `  [*] --> ${s.id}`),
    // 自分自身に戻る遷移は図に描かない（線が図を埋めるため）。操作の節の「できるとき」には残る。
    ...(collapseTransitions(graph).some((t) => t.from === ANY) ? [`  state "${ANY_LABEL}" as any`] : []),
    ...collapseTransitions(graph)
      .filter((t) => t.from !== t.to)
      .map((t) => `  ${t.from === ANY ? "any" : t.from} --> ${t.to}: ${t.action} (${t.actors.join(", ")})`),
    ...graph.states.filter((s) => s.terminal).map((s) => `  ${s.id} --> [*]`),
    "```",
    "",
    "## 操作",
    "",
    ...summarizeActions(spec, graph).flatMap((a) => [
      ...actionSection(a),
      ...graph.questions.filter((q) => q.action === a.name).map((q) => `- **未決**: ${q.ask}`),
      "",
    ]),
    ...(graph.links.length + incoming.length === 0
      ? []
      : [
          "## つながり",
          "",
          ...graph.links.map((l) => `- ${l.from === null ? "" : `${ownAction(l.from)} `}→ ${endpoint(objects, l.to, l.action)}: ${l.label}`),
          ...incoming.map((l) => `- ${l.action === null ? "" : `${ownAction(l.action)} `}← ${endpoint(objects, l.source, l.from)}から: ${l.label}`),
          "",
        ]),
    ...(graph.scenarios.length === 0 ? [] : ["## シナリオ", "", ...graph.scenarios.flatMap((s) => [...scenarioSection(spec, s, labelOf), ""])]),
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
  const groups = presentBlocked(a.blocked).map((b) => `${b.states === null ? "それ以外のすべての状態" : b.states.join(", ")}（${b.reason}）`);
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
    `- **できるとき**: ${a.when.map(formatTransition).join(" / ")}`,
    whenNot,
    ...(a.inputOutcomes.length === 0
      ? []
      : [
          [
            "- **入力ごとの結果**:",
            ...a.inputOutcomes.map((o) =>
              o.transitions.length > 0
                ? `  - ${o.input}: ${o.transitions.map(formatTransition).join(" / ")}`
                : `  - ${o.input}: ❌ ${o.reasons.join("、")}`,
            ),
          ].join("\n"),
        ]),
    ...(effect === "" ? [] : [`- **結果**: ${effect}`]),
  ];
};

export const questionTarget = (spec: Spec, q: Graph["questions"][number], labelOf: (id: string) => string) =>
  q.action !== null
    ? `（操作: ${(spec.docs[q.action] ?? q.action).replace(/。$/, "")}）`
    : q.states.length > 0
      ? `（状態: ${q.states.map(labelOf).join(", ")}）`
      : "";

export const describeStep = (spec: Spec, step: Graph["scenarios"][number]["steps"][number]) => {
  // 文の途中に入れるので、見出しの末尾の「。」は外す（「起動する。（start）」のようにならないように）。
  const what = (spec.docs[step.action] ?? step.action).replace(/。$/, "");
  const detail = step.input === null ? step.action : `${step.action}、${step.input}`;
  return `${step.actor} が ${what}（${detail}）`;
};

const scenarioSection = (spec: Spec, s: Graph["scenarios"][number], labelOf: (id: string) => string): Array<string> => [
  `### ${s.passed ? "✅" : "❌"} ${s.name}`,
  "",
  ...s.steps.map((step, i) =>
    step.ok
      ? `${i + 1}. ${describeStep(spec, step)}: ${labelOf(step.from ?? "")} → ${labelOf(step.to ?? "")}`
      : `${i + 1}. ❌ ${describeStep(spec, step)}: ${step.reason}`,
  ),
];

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
    case "link-unresolved":
      return `つながりの相手 ${f.to}${f.action === null ? "" : ` の ${f.action}`} が見つからない`;
    case "question-unmatched":
      return `未決事項「${f.ask}」の対象の状態が、到達できるどの状態にも当てはまらない`;
    case "scenario-failed":
      return `シナリオ「${f.scenario}」の ${f.step} 段目で止まった: ${f.reason}`;
    case "state-limit":
      return `状態が ${f.maxStates} 個を超えたので探索を打ち切った（値が増え続ける項目がないか確認する）`;
  }
};
