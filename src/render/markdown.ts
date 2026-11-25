import type { Spec } from "../load.ts";
import type { Finding, Graph } from "../model.ts";

export const renderMarkdown = (spec: Spec, graph: Graph): string => {
  const actions = spec.actions.map(([name]) => name);
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
    ...actions.flatMap((name) => [...actionSection(graph, name, spec.docs[name], labelOf), ""]),
    "## 検査結果",
    "",
    ...(graph.findings.length === 0 ? ["問題は見つかりませんでした。"] : graph.findings.map((f) => `- ⚠ ${describe(f, labelOf)}`)),
    "",
  ].join("\n");
};

// 「担当者」= どこかの状態で一度でもその操作を実行できた登場人物。
// 担当者が止められた理由を「いつ」の条件、担当者以外が止められた理由を「誰が」の条件とみなす。
// spec の書き手に ensure を「権限」「状態」と分類させずに、実行結果だけから両者を分けるため。
const actionSection = (
  graph: Graph,
  action: string,
  summary: string | undefined,
  labelOf: (id: string) => string,
): Array<string> => {
  const heading = summary === undefined ? `### \`${action}\`` : `### ${summary}（\`${action}\`）`;
  const entries = graph.availability.filter((a) => a.action === action);
  const capable = unique(entries.filter((a) => a.enabled).map((a) => a.actor));
  if (capable.length === 0) return [heading, "", "- **できる人**: なし（どの状態でも誰も実行できない）"];

  const othersReasons = unique(entries.filter((a) => !capable.includes(a.actor)).map((a) => a.reason ?? "エラー"));
  const who = othersReasons.length === 0 ? capable.join(", ") : `${capable.join(", ")}（ほかの人は「${othersReasons.join("」「")}」）`;

  const when = unique(
    graph.transitions.filter((t) => t.action === action).map((t) => `${labelOf(t.from)} → ${labelOf(t.to)}`),
  ).join(" / ");

  const blockedGroups = new Map<string, Array<string>>();
  for (const state of unique(entries.map((a) => a.state))) {
    const byCapable = entries.filter((a) => a.state === state && capable.includes(a.actor));
    if (byCapable.some((a) => a.enabled)) continue;
    const reason = unique(byCapable.map((a) => a.reason ?? "エラー")).join("、");
    blockedGroups.set(reason, [...(blockedGroups.get(reason) ?? []), labelOf(state)]);
  }
  const groups = [...blockedGroups.entries()].map(([reason, states]) => `${states.join(", ")}（${reason}）`);
  const whenNot =
    groups.length === 0 ? "- **できないとき**: なし" : groups.length === 1 ? `- **できないとき**: ${groups[0]}` : ["- **できないとき**:", ...groups.map((g) => `  - ${g}`)].join("\n");

  const effect = effectOf(graph, action);
  return [
    heading,
    "",
    `- **できる人**: ${who}`,
    `- **できるとき**: ${when}`,
    whenNot,
    ...(effect === "" ? [] : [`- **結果**: ${effect}`]),
  ];
};

const unique = <A>(xs: ReadonlyArray<A>): Array<A> => [...new Set(xs)];

const effectOf = (graph: Graph, action: string): string => {
  const changed = new Map<string, Set<string>>();
  for (const t of graph.transitions) {
    if (t.action !== action) continue;
    const from = graph.states.find((s) => s.id === t.from)!.values;
    const to = graph.states.find((s) => s.id === t.to)!.values;
    for (const k of Object.keys(to)) {
      if (JSON.stringify(from[k]) === JSON.stringify(to[k])) continue;
      if (!changed.has(k)) changed.set(k, new Set());
      changed.get(k)!.add(typeof to[k] === "string" ? (to[k] as string) : JSON.stringify(to[k]));
    }
  }
  return [...changed.entries()].map(([k, vs]) => `${k} → ${[...vs].join(" / ")}`).join(", ");
};

const describe = (f: Finding, labelOf: (id: string) => string): string => {
  switch (f.kind) {
    case "unreachable-value":
      return `${f.field} = ${String(f.value)} は型に書かれているが、到達できるどの状態でもとらない`;
    case "never-enabled-action":
      return `操作 ${f.action} は、到達できるどの状態でも誰も実行できない`;
    case "action-error":
      return `操作 ${f.action} が ${labelOf(f.state)} で ${f.actor} が実行したときに例外を投げた: ${f.message}`;
    case "invalid-return":
      return `操作 ${f.action} が ${labelOf(f.state)} で ${f.actor} が実行したときにオブジェクトを返さなかった`;
    case "state-limit":
      return `状態が ${f.maxStates} 個を超えたので探索を打ち切った（値が増え続ける項目がないか確認する）`;
  }
};

