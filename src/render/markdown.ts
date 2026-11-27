import type { EnsureCheck } from "../model.ts";
import { describeEnsure } from "./ensures.ts";
import { markdownSection } from "./sections.ts";
import { propertyRows } from "./properties.ts";
import { projectRelations } from "../relations.ts";
import { actionTitle, canOnlyWhen } from "../labels.ts";
import { REVIEW_LEAD, REVIEW_TITLE, reviewItems, unguardedId } from "./review.ts";
import type { Spec } from "../load.ts";
import type { Finding, Graph } from "../model.ts";
import { collapseTransitions, isCollapsed, sourceLabel } from "./collapse.ts";
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
  `[${objects.find((o) => o.spec.name === object)?.spec.displayName ?? object}](${object}.md)${action === null ? "" : ` の ${actionName(objects, object, action)}`}`;

const allLinks = (objects: Objects) =>
  objects.flatMap(({ spec, graph }) => graph.links.map((l) => ({ ...l, source: spec.name })));

const LEFT = { many: "}o", one: "||" } as const;
const RIGHT = { many: "o{", one: "||" } as const;

const relationsSection = (objects: Objects): Array<string> => {
  const relations = projectRelations(objects);
  if (relations.length === 0) return [];
  const names = objects.map((o) => o.spec.name);
  const id = (name: string) => `e${names.indexOf(name)}`;
  const involved = names.filter((n) => relations.some((r) => r.from === n || r.to === n));
  const attribute = (spec: Spec, field: string) =>
    spec.refs.some((r) => r.field === field) ? `ref ${field}` : spec.fields[field]?.every((v) => typeof v === "boolean") ? `bool ${field}` : `enum ${field}`;
  return [
    ...markdownSection("関連"),
    "```mermaid",
    "erDiagram",
    ...involved.flatMap((name) => {
      const spec = objects.find((o) => o.spec.name === name)!.spec;
      const fields = [...new Set([...Object.keys(spec.fields), ...spec.refs.map((r) => r.field)])];
      return [`  ${id(name)}["${name}"] {`, ...fields.map((f) => `    ${attribute(spec, f)}`), "  }"];
    }),
    // 逆向きの項目が無ければ、相手 1 つにいくつ結びつくかは決まっていない（0 以上）として描く。
    ...relations.map(
      (r) =>
        `  ${id(r.from)} ${r.fromMany === false ? LEFT.one : LEFT.many}--${r.toMany ? RIGHT.many : RIGHT.one} ${id(r.to)} : "${[r.fields.join(", "), ...(r.back.length === 0 ? [] : [r.back.join(", ")])].join(" / ")}"`,
    ),
    "```",
    "",
  ];
};

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
        `| [${spec.displayName}](${spec.name}.md) | ${spec.stateDoc ?? ""} | ${graph.states.length} | ${spec.actions.length} | ${graph.questions.length} | ${graph.findings.length === 0 ? "OK" : `⚠ ${graph.findings.length}`} |`,
    ),
    "",
    ...relationsSection(objects),
    ...(allLinks(objects).length === 0
      ? []
      : [
          ...markdownSection("つながり"),
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
    `# ${spec.displayName}`,
    "",
    ...(spec.stateDoc === null ? [] : [spec.stateDoc, ""]),
    // 用語を未決事項より前に置く理由: 未決事項や判断待ちの文は状態の値や業務の言葉で書かれるので、その意味を知らないと読めないため。
    ...glossarySection(spec),
    // 未決事項を状態遷移図より前に置く理由: AI が書いた仕様のうち、人が判断すべきなのはここだけ、という
    // 入口にしたいため。全体を読む前に、判断が必要な点が目に入るようにする。
    ...(graph.questions.length === 0
      ? []
      : [
          ...markdownSection("未決事項"),
          ...graph.questions.flatMap((q, i) => [
            `${i + 1}. ${q.ask}${questionTarget(spec, q, labelOf)}`,
            ...(q.note === null ? [] : [`   - ${q.note}`]),
          ]),
          "",
        ]),
    ...reviewSection(spec, graph),
    ...markdownSection("状態遷移図"),
    "```mermaid",
    "stateDiagram-v2",
    ...graph.states.map((s) => `  state "${s.label}" as ${s.id}`),
    ...graph.states.filter((s) => s.initial).map((s) => `  [*] --> ${s.id}`),
    // 自分自身に戻る遷移は図に描かない（線が図を埋めるため）。操作の節の「できるとき」には残る。
    ...[...new Set(collapseTransitions(graph).map((t) => t.from).filter(isCollapsed))].map((id, i) => `  state "${sourceLabel(graph, id)}" as any${i}`),
    ...collapseTransitions(graph)
      .filter((t) => t.from !== t.to)
      .map((t) => `  ${isCollapsed(t.from) ? mermaidSource(graph, t.from) : t.from} --> ${t.to}: ${actionTitle(spec, t.action)} (${t.actors.join(", ")})`),
    ...graph.states.filter((s) => s.terminal).map((s) => `  ${s.id} --> [*]`),
    "```",
    "",
    ...propertiesSection(spec),
    ...markdownSection("操作"),
    ...summarizeActions(spec, graph).flatMap((a) => [
      ...actionSection(a),
      ...graph.questions.flatMap((q, i) => (q.action === a.name ? [`- **未決**: 未決事項 ${i + 1}`] : [])),
      ...ensureLines((graph.ensures ?? []).filter((e) => e.action === a.name), spec.reviewed, graph),
      "",
    ]),
    ...(graph.links.length + incoming.length === 0
      ? []
      : [
          ...markdownSection("つながり"),
          ...graph.links.map((l) => `- ${l.from === null ? "" : `${ownAction(l.from)} `}→ ${endpoint(objects, l.to, l.action)}: ${l.label}`),
          ...incoming.map((l) => `- ${l.action === null ? "" : `${ownAction(l.action)} `}← ${endpoint(objects, l.source, l.from)}から: ${l.label}`),
          "",
        ]),
    ...(graph.decisions.length === 0 ? [] : [...markdownSection("ルール"), ...graph.decisions.flatMap((d) => [...decisionTable(d), ""])]),
    ...(graph.scenarios.length === 0 ? [] : [...markdownSection("シナリオ"), ...graph.scenarios.flatMap((s) => [...scenarioSection(spec, s, labelOf, graph.questions), ""])]),
    ...screensSection(spec, graph),
    ...markdownSection("検査結果"),
    ...(graph.findings.length === 0 ? [noFindingsLine(spec, graph)] : graph.findings.map((f) => `- ⚠ ${describeFinding(f, labelOf)}`)),
    "",
  ].join("\n");
};

// 検査結果が無いときも、判断待ちや確かめてほしい点が残っていれば添える。「問題は見つかりませんでした」だけだと、
// 上に挙げた点が解消済みなのかと迷わせるため。
const mermaidSource = (graph: Graph, id: string) =>
  `any${[...new Set(collapseTransitions(graph).map((t) => t.from).filter(isCollapsed))].indexOf(id)}`;

export const noFindingsLine = (spec: Spec, graph: Graph): string => {
  const { pending, onHold } = reviewItems(spec, graph);
  const rest = [...(onHold.length === 0 ? [] : [`判断待ち ${onHold.length} 件`]), ...(pending.length === 0 ? [] : [`確かめてほしい点 ${pending.length} 件`])];
  return rest.length === 0 ? "問題は見つかりませんでした。" : `問題は見つかりませんでした（ただし、${rest.join("と")}を上に挙げている）。`;
};

export const testsOf = (graph: Graph, e: Pick<EnsureCheck, "action" | "reason">) =>
  (graph.tests ?? []).filter((t) => t.target === `ensure:${e.action}:${e.reason}`).map((t) => `${t.file}:${t.line}`);

const ensureLines = (ensures: ReadonlyArray<EnsureCheck>, reviewed: Spec["reviewed"], graph: Graph): Array<string> =>
  ensures.length === 0
    ? []
    : [
        "- **条件**:",
        ...ensures.map((e) => {
          const tests = testsOf(graph, e);
          return `  - ${describeEnsure(e, reviewed[unguardedId(e)] !== undefined)}${tests.length === 0 ? "" : `（テスト: ${tests.join("、")}）`}`;
        }),
      ];

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
      : ["### 判断待ち（未決事項）", "", ...onHold.map((i) => `- ${i.message}（\`${i.id}\`）— 未決事項 ${i.question} で判断を待っている`), ""]),
    ...(acknowledged.length === 0 ? [] : ["### 確認済み", "", ...acknowledged.map((i) => `- \`${i.id}\`: ${i.note}`), ""]),
  ];
};

const actionSection = (a: ActionSummary): Array<string> => {
  const heading = a.summary === null ? `### \`${a.name}\`` : `### ${a.summary}`;
  const name = a.summary === null ? [] : [`- **関数名**: \`${a.name}\``];
  if (a.capable.length === 0) return [heading, "", "- **できる人**: なし（どの状態でも誰も実行できない）", ...name];
  const who =
    a.othersReasons.length === 0 ? a.capable.join(", ") : `${a.capable.join(", ")}（ほかの人は「${a.othersReasons.join("」「")}」）`;
  const groups = presentBlocked(a.blocked).map((b) => `${b.states === null ? "それ以外のすべての状態" : b.states.join(", ")}（${canOnlyWhen(b.reason)}）`);
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
                : `  - ${o.input}: ❌ ${o.reasons.map(canOnlyWhen).join("、")}`,
            ),
          ].join("\n"),
        ]),
    ...(effect === "" ? [] : [`- **結果**: ${effect}`]),
    ...name,
  ];
};

const glossarySection = (spec: Spec): Array<string> => {
  const terms = Object.entries(spec.glossary).map(([term, doc]) => `- **${term}**: ${doc}`);
  return terms.length === 0 ? [] : [...markdownSection("用語"), ...terms, ""];
};

const propertiesSection = (spec: Spec): Array<string> => {
  const rows = propertyRows(spec);
  if (rows.length === 0) return [];
  return [
    ...markdownSection("プロパティ"),
    "| 項目 | 型 | 説明 | 扱い | 値 |",
    "|---|---|---|---|---|",
    ...rows.map((r) => `| ${r.field} | \`${r.type.replace(/\|/g, "\\|")}\` | ${r.doc} | ${r.kind} | ${r.values.map((v) => (v.doc === null ? v.value : `${v.value}（${v.doc}）`)).join(" / ")} |`),
    "",
  ];
};

const screensSection = (spec: Spec, graph: Graph): Array<string> => {
  const states = summarizeStates(spec, graph).filter((s) => s.surfaces.length > 0);
  if (states.length === 0) return [];
  const invalidFor = (state: string, actors: ReadonlyArray<string>) =>
    graph.findings.flatMap((f) => (f.kind === "surface-action-not-allowed" && f.state === state && actors.includes(f.actor) ? [f.action] : []));
  return [
    ...markdownSection("画面"),
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

// 未決事項が指すシナリオは、今の動きを写しただけで正しいと決めたものではないので、通っても ✅ にしない。
// ✅ だと「合意済みの仕様」に見えるため。
export const scenarioTitle = (s: Graph["scenarios"][number], questions: Graph["questions"]): string => {
  const q = questions.findIndex((x) => x.scenario === s.name);
  const from = s.given === undefined ? "" : `（${Object.entries(s.given).map(([k, v]) => `${k}: ${String(v)}`).join("、")} から）`;
  if (!s.passed) return `❌ ${s.name}${from}`;
  return q === -1 ? `✅ ${s.name}${from}` : `⚠ ${s.name}${from}（未決事項 ${q + 1} を判断中）`;
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

const scenarioSection = (spec: Spec, s: Graph["scenarios"][number], labelOf: (id: string) => string, questions: Graph["questions"]): Array<string> => [
  `### ${scenarioTitle(s, questions)}`,
  "",
  ...s.steps.map((step, i) =>
    step.ok && step.denied
      ? `${i + 1}. ${describeStep(spec, step)}: この操作はできない（${canOnlyWhen(step.reason ?? "")}）`
      : step.ok
      ? `${i + 1}. ${describeStep(spec, step)}: ${labelOf(step.from ?? "")} → ${labelOf(step.to ?? "")}`
      : `${i + 1}. ❌ ${describeStep(spec, step)}: ${step.reason}`,
  ),
];

export const formatEffect = (a: ActionSummary) =>
  a.effect.map((e) => `${e.field} → ${e.values.join(" / ")}${e.partial ? "（変わらない場合もある）" : ""}`).join(", ");

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
    case "test-link-unknown":
      return `テスト ${f.file}:${f.line} が、spec に無い項目を指している（${f.target}）。spec を先に変えたなら、テストと実装をそれに合わせる`;
    case "ref-unresolved":
      return `項目 ${f.field} の @ref で指した ${f.target} という spec（または状態の型）が無い`;
    case "question-scenario-unknown":
      return `未決事項「${f.ask}」が指すシナリオ「${f.scenario}」が無い`;
    case "question-unmatched":
      return `未決事項「${f.ask}」の対象の状態が、到達できるどの状態にも当てはまらない`;
    case "scenario-failed":
      return `シナリオ「${f.scenario}」の ${f.step} 段目で止まった: ${f.reason}`;
    case "state-limit":
      return `状態が ${f.maxStates} 個を超えたので探索を打ち切った（値が増え続ける項目がないか確認する）`;
  }
};
