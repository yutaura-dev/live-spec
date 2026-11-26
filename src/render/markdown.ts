import type { EnsureCheck } from "../model.ts";
import { describeEnsure } from "./ensures.ts";
import { REVIEW_LEAD, REVIEW_TITLE, reviewItems, unguardedId } from "./review.ts";
import type { Spec } from "../load.ts";
import type { Finding, Graph } from "../model.ts";
import { ANY, ANY_LABEL, collapseTransitions } from "./collapse.ts";
import { formatTransition, presentBlocked, summarizeActions, summarizeStates, type ActionSummary } from "./summary.ts";
import type { SurfaceNode } from "../surface.ts";
import { surfaceToText } from "./wireframe.ts";

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
    ...reviewSection(spec, graph),
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
    ...glossarySection(spec),
    "## 操作",
    "",
    ...summarizeActions(spec, graph).flatMap((a) => [
      ...actionSection(a),
      ...((spec.evidence[a.name] ?? []).length === 0 ? [] : [`- **根拠**: ${spec.evidence[a.name]!.map(formatEvidence).join("、")}`]),
      ...graph.questions.filter((q) => q.action === a.name).map((q) => `- **未決**: ${q.ask}`),
      ...ensureLines((graph.ensures ?? []).filter((e) => e.action === a.name), spec.reviewed),
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
    ...(graph.decisions.length === 0 ? [] : ["## ルール", "", ...graph.decisions.flatMap((d) => [...decisionTable(d), ""])]),
    ...(graph.scenarios.length === 0 ? [] : ["## シナリオ", "", ...graph.scenarios.flatMap((s) => [...scenarioSection(spec, s, labelOf), ""])]),
    ...screensSection(spec, graph),
    "## 検査結果",
    "",
    ...(graph.findings.length === 0 ? ["問題は見つかりませんでした。"] : graph.findings.map((f) => `- ⚠ ${describeFinding(f, labelOf)}`)),
    "",
  ].join("\n");
};

const ensureLines = (ensures: ReadonlyArray<EnsureCheck>, reviewed: Spec["reviewed"]): Array<string> =>
  ensures.length === 0 ? [] : ["- **条件**:", ...ensures.map((e) => `  - ${describeEnsure(e, reviewed[unguardedId(e)] !== undefined)}`)];

const reviewSection = (spec: Spec, graph: Graph): Array<string> => {
  const { pending, onHold, acknowledged } = reviewItems(spec, graph);
  if (pending.length + onHold.length + acknowledged.length === 0) return [];
  return [
    `## ${REVIEW_TITLE}`,
    "",
    ...(pending.length === 0 ? ["確かめてほしい点はありません。"] : [REVIEW_LEAD, "", ...pending.map((i) => `- ${i.message}（\`${i.id}\`）`)]),
    "",
    ...(onHold.length === 0
      ? []
      : ["### 判断待ち（未決事項）", "", ...onHold.map((i) => `- ${i.message}（\`${i.id}\`）— 未決事項 ${i.question}「${i.ask}」`), ""]),
    ...(acknowledged.length === 0 ? [] : ["### 確認済み", "", ...acknowledged.map((i) => `- \`${i.id}\`: ${i.note}`), ""]),
  ];
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

// 根拠の先頭（空白か「（」まで）をコードの場所としてコード書式にし、残りは補足として続ける。
export const splitEvidence = (text: string): { readonly path: string; readonly rest: string } => {
  const m = /^(\S+?)((?:（|\s).*)?$/.exec(text);
  return { path: m?.[1] ?? text, rest: m?.[2] ?? "" };
};

const formatEvidence = (text: string) => {
  const { path, rest } = splitEvidence(text);
  return `\`${path}\`${rest}`;
};

const glossarySection = (spec: Spec): Array<string> => {
  const fields = Object.entries(spec.fieldDocs).map(([field, doc]) => {
    const values = spec.fields[field];
    return `- **${field}**（項目）: ${doc}${values === undefined ? "" : `。値: ${values.map(String).join(" / ")}`}`;
  });
  const terms = Object.entries(spec.glossary).map(([term, doc]) => `- **${term}**: ${doc}`);
  return fields.length + terms.length === 0 ? [] : ["## 用語", "", ...fields, ...terms, ""];
};

const screensSection = (spec: Spec, graph: Graph): Array<string> => {
  const states = summarizeStates(spec, graph).filter((s) => s.surfaces.length > 0);
  if (states.length === 0) return [];
  const invalidFor = (state: string, actors: ReadonlyArray<string>) =>
    graph.findings.flatMap((f) => (f.kind === "surface-action-not-allowed" && f.state === state && actors.includes(f.actor) ? [f.action] : []));
  return [
    "## 画面",
    "",
    ...states.flatMap((s) => [
      `### ${s.label}`,
      "",
      ...s.surfaces.flatMap((g) => [
        `${g.actors.join(", ")} が見る画面:`,
        "",
        "```text",
        surfaceToText(g.surface as SurfaceNode, invalidFor(s.id, g.actors)),
        "```",
        "",
      ]),
    ]),
  ];
};

const cell = (v: unknown) => (v === undefined || v === null ? "" : typeof v === "string" ? v : JSON.stringify(v));

export const inputCell = (input: unknown, column: string) =>
  typeof input === "object" && input !== null ? cell((input as Record<string, unknown>)[column]) : cell(input);

export const resultCell = (r: Graph["decisions"][number]["rows"][number]) =>
  r.ok ? cell(r.result) : `❌ ${cell(r.result)}（期待: ${cell(r.expect)}）`;

const decisionTable = (d: Graph["decisions"][number]): Array<string> => [
  `### ${d.name}`,
  "",
  `| ${[...d.columns, "結果"].join(" | ")} |`,
  `|${[...d.columns, "結果"].map(() => "---").join("|")}|`,
  ...d.rows.map((r) => `| ${[...d.columns.map((c) => inputCell(r.input, c)), resultCell(r)].join(" | ")} |`),
];

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
    step.ok && step.denied
      ? `${i + 1}. ${describeStep(spec, step)}: 断られる（${step.reason}）`
      : step.ok
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
    case "evidence-missing":
      return `${f.action} の根拠「${f.evidence}」のファイルが見つからない（移動・改名されたか、起点が違う。別の場所のコードなら export const evidenceRoot を書く）`;
    case "evidence-out-of-range":
      return `${f.action} の根拠「${f.evidence}」の行が、ファイルの行数（${f.lines} 行）を超えている（コードが変わって行がずれた）`;
    case "evidence-moved":
      return `${f.action} の根拠「${f.location}」は、同じコードが ${f.moved} 行目に移った（live-spec evidence --update で根拠の行番号を直せる）`;
    case "evidence-changed":
      return `${f.action} の根拠「${f.location}」の、根拠のコードの中身が変わった。spec を見直し、よければ live-spec evidence --update で記録し直す`;
    case "evidence-unlocked":
      return `${f.action} の根拠「${f.location}」が lock に記録されていない（live-spec evidence --update で記録する）`;
    case "goal-unreachable":
      return `目指す状態「${f.goal}」には、どの状態からもたどり着けない`;
    case "reviewed-unmatched":
      return `reviewed に書かれた ${f.id} は、確かめてほしい点のどれにも当たらない（ID の書き間違いか、もう出なくなった候補）`;
    case "surface-action-not-allowed":
      return `${labelOf(f.state)} で ${f.actor} に ${f.action} のボタンが見えているが、実行できない`;
    case "surface-action-missing":
      return `${labelOf(f.state)} で ${f.actor} は ${f.action} を実行できるが、画面にボタンがない`;
    case "surface-error":
      return `${labelOf(f.state)} で ${f.actor} の画面を作るときに例外を投げた: ${f.message}`;
    case "link-unresolved":
      return `つながりの相手 ${f.to}${f.action === null ? "" : ` の ${f.action}`} が見つからない`;
    case "decision-mismatch":
      return `ルール「${f.decision}」の ${f.row} 行目の結果が期待と違う（期待: ${f.expected}、実際: ${f.actual}）`;
    case "decision-error":
      return `ルール「${f.decision}」の ${f.row} 行目で例外を投げた: ${f.message}`;
    case "question-unmatched":
      return `未決事項「${f.ask}」の対象の状態が、到達できるどの状態にも当てはまらない`;
    case "scenario-failed":
      return `シナリオ「${f.scenario}」の ${f.step} 段目で止まった: ${f.reason}`;
    case "state-limit":
      return `状態が ${f.maxStates} 個を超えたので探索を打ち切った（値が増え続ける項目がないか確認する）`;
  }
};
