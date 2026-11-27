import { runAction, type ExploreOptions } from "./explore.ts";
import { actionTitle } from "./labels.ts";
import type { Spec, State } from "./load.ts";
import type { Graph, OmissionHint } from "./model.ts";

export type { OmissionHint } from "./model.ts";
export type OmissionKind = OmissionHint["kind"];

type Row = Graph["availability"][number];

const groupBy = <K>(rows: ReadonlyArray<Row>, keyOf: (r: Row) => K) => {
  const groups = new Map<string, Array<Row>>();
  for (const r of rows) {
    const key = JSON.stringify(keyOf(r));
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups.values()];
};

const enabledOf = (r: Row) => String(r.enabled);
// 行き先まで含める理由: 入力や登場人物によって行き先が変わる操作は、可否が同じでも、その入力・登場人物を見ている。
const outcomeOf = (r: Row) => (r.enabled ? `ok:${r.to}` : "no");

const invariantAcross = (rows: ReadonlyArray<Row>, rest: (r: Row) => unknown, result: (r: Row) => string) =>
  groupBy(rows, rest).every((g) => new Set(g.map(result)).size === 1);

const signatures = (rows: ReadonlyArray<Row>, valueOf: (r: Row) => string, rest: (r: Row) => unknown) => {
  const byValue = new Map<string, Array<Row>>();
  for (const r of rows) byValue.set(valueOf(r), [...(byValue.get(valueOf(r)) ?? []), r]);
  return new Map(
    [...byValue].map(([value, rs]) => [
      value,
      JSON.stringify(rs.map((r) => [JSON.stringify(rest(r)), outcomeOf(r)]).sort(([a], [b]) => (a! < b! ? -1 : a! > b! ? 1 : 0))),
    ]),
  );
};

const sameGroups = (sigs: Map<string, string>) => {
  const bySig = new Map<string, Array<string>>();
  for (const [value, sig] of sigs) bySig.set(sig, [...(bySig.get(sig) ?? []), value]);
  return [...bySig.values()].filter((g) => g.length > 1);
};

const isPlainObject = (u: unknown): u is Readonly<Record<string, unknown>> => typeof u === "object" && u !== null && !Array.isArray(u);

// 1 つの属性だけが違う 2 人の組。「別の著者bob」と「著者alice」のように id だけが違う組は、
// 「自分の〜だけ」の条件があるかどうかで扱いが分かれるはずの組なので、区別の有無を比べる対象にする。
const similarPairs = (spec: Spec) => {
  const pairs: Array<{ p: string; q: string; key: string }> = [];
  for (const [i, [p, pv]] of spec.actors.entries()) {
    for (const [q, qv] of spec.actors.slice(i + 1)) {
      if (!isPlainObject(pv) || !isPlainObject(qv)) continue;
      const keys = [...new Set([...Object.keys(pv), ...Object.keys(qv)])];
      const differing = keys.filter((k) => JSON.stringify(pv[k]) !== JSON.stringify(qv[k]));
      if (differing.length === 1) pairs.push({ p, q, key: differing[0]! });
    }
  }
  return pairs;
};

const distinguishes = (rows: ReadonlyArray<Row>, p: string, q: string) =>
  groupBy(
    rows.filter((r) => r.actor === p || r.actor === q),
    (r) => [r.state, r.input],
  ).some((g) => new Set(g.map((r) => r.enabled)).size > 1);

export const findOmissionHints = (spec: Spec, graph: Graph, options: Pick<ExploreOptions, "bypassEnsure"> = {}): Array<OmissionHint> => {
  const hints: Array<OmissionHint> = [];
  const rowsOf = (action: string) => graph.availability.filter((r) => r.action === action);
  const distinctActors = new Set(spec.actors.map(([, v]) => JSON.stringify(v))).size;
  const pairs = similarPairs(spec);

  for (const [action] of spec.actions) {
    const rows = rowsOf(action);
    if (!rows.some((r) => r.enabled)) continue;
    if (distinctActors > 1 && invariantAcross(rows, (r) => [r.state, r.input], outcomeOf)) {
      hints.push({
        id: `anyone-can:${action}`,
        kind: "anyone-can",
        action,
        field: null,
        message: `${action} は、誰が実行しても可否が変わらない（誰でもできる）。「〜だけ」の条件を書き忘れていないか`,
      });
    }
    if (graph.states.length > 1 && invariantAcross(rows, (r) => [r.actor, r.input], enabledOf)) {
      hints.push({
        id: `anytime:${action}`,
        kind: "anytime",
        action,
        field: null,
        message: `${action} は、どの状態でも可否が変わらない（いつでもできる）。状態の条件を書き忘れていないか`,
      });
    }
    const inputCount = spec.inputs[action]?.length ?? 0;
    const ignoresInput = inputCount > 1 && invariantAcross(rows, (r) => [r.state, r.actor], outcomeOf);
    if (ignoresInput) {
      hints.push({
        id: `ignores-input:${action}`,
        kind: "ignores-input",
        action,
        field: null,
        message: `${action} は、入力の例を変えても結果が変わらない。入力の検証を書き忘れていないか`,
      });
    }
    // 断られる例同士が同じ結果なのは、境目の値を確かめる書き方なので候補にしない。
    // 実行できる例同士が同じ結果なのは、違う結果を期待して選んだ例が、条件の書き忘れで同じになった可能性がある。
    if (inputCount > 2 && !ignoresInput) {
      const accepted = new Set(rows.filter((r) => r.enabled).map((r) => r.input ?? ""));
      for (const group of sameGroups(signatures(rows, (r) => r.input ?? "", (r) => [r.state, r.actor]))) {
        if (!group.every((g) => accepted.has(g))) continue;
        hints.push({
          id: `indistinguishable-example:${action}:${group.join(",")}`,
          kind: "indistinguishable-example",
          action,
          field: null,
          message: `${action} の入力の例「${group.join("」「")}」は、結果がまったく同じ。違う結果を期待していなかったか（条件の書き忘れ）`,
        });
      }
    }
    const blind = pairs.filter(({ p, q }) => rows.some((r) => r.enabled && (r.actor === p || r.actor === q)) && !distinguishes(rows, p, q));
    const reported = blind
      .map(({ p, q, key }) => ({ p, q, key, others: spec.actions.map(([n]) => n).filter((n) => n !== action && distinguishes(rowsOf(n), p, q)) }))
      .filter((b) => b.others.length > 0);
    if (reported.length > 0) {
      const others = [...new Set(reported.flatMap((b) => b.others))];
      hints.push({
        id: `same-for-similar-actors:${action}`,
        kind: "same-for-similar-actors",
        action,
        field: null,
        message: `${action} は、${reported.map((b) => `${b.p} と ${b.q}（${b.key} だけが違う）`).join("、")}を区別しない。${others.join(", ")} は区別している。「自分の〜だけ」の条件を書き忘れていないか`,
      });
    }
  }

  // 登場人物は、違う振る舞いを確かめるために書き手が選んだもの。すべての操作で結果が同じ 2 人は、
  // 2 人を分けるはずの条件が書き忘れられている可能性がある。
  for (const group of sameGroups(signatures(graph.availability, (r) => r.actor, (r) => [r.state, r.action, r.input]))) {
    if (!graph.availability.some((r) => r.enabled && group.includes(r.actor))) continue;
    hints.push({
      id: `indistinguishable-actor:${group.join(",")}`,
      kind: "indistinguishable-actor",
      action: null,
      field: null,
      message: `登場人物「${group.join("」「")}」は、どの状態・操作でも結果がまったく同じ。2 人を分けるはずの条件を書き忘れていないか`,
    });
  }

  hints.push(...unusedFields(spec, graph, options));
  hints.push(...deadEnds(spec, graph));
  hints.push(...equivalentStates(graph));
  return hints;
};

const holds = (fn: Spec["goals"][number][1], values: State) => {
  try {
    return Boolean((fn as (s: unknown) => unknown)(structuredClone(values)));
  } catch {
    return false;
  }
};

// 袋小路の中の状態をすべて出さずに入口だけを出す理由: 1 つの原因で入った袋小路の中には状態がいくつもあり、
// 全部を並べると同じ指摘が何件も出る。入口（たどり着ける状態から 1 手で入る状態）を直せば中も解消する。
// 振る舞いが同じ状態は、状態機械の最小化（分割の細分化）で求める。各状態を「操作・登場人物・入力ごとの可否と理由、
// 行き先が属する組、見える画面」で比べ、組が分かれなくなるまで繰り返す。行き先をそのまま比べないのは、todo から
// 「進行中へ移す」と進行中から同じ操作をしたときのように、互いの状態へ移る線だけが違って見えてしまうため。
// 終端の状態は、意味（成功と失敗など）で分けていることが多いので候補にしない。
const equivalentStates = (graph: Graph): Array<OmissionHint> => {
  const active = graph.states.filter((s) => !s.terminal);
  if (active.length < 2) return [];
  const screens = new Map(
    graph.states.map((s) => [s.id, JSON.stringify(graph.surfaces.filter((x) => x.state === s.id).map((x) => JSON.stringify([x.actor, x.surface])).sort())]),
  );
  let block = new Map(graph.states.map((s) => [s.id, s.terminal ? `end:${s.id}` : "active"]));
  for (;;) {
    const signature = (id: string) =>
      JSON.stringify([
        block.get(id),
        screens.get(id),
        graph.availability
          .filter((r) => r.state === id)
          .map((r) => JSON.stringify([r.action, r.actor, r.input, r.enabled, r.reason, r.to === null ? null : block.get(r.to)]))
          .sort(),
      ]);
    const next = new Map(graph.states.map((s) => [s.id, signature(s.id)]));
    const stable = new Set(next.values()).size === new Set(block.values()).size;
    block = next;
    if (stable) break;
  }
  const groups = new Map<string, Array<Graph["states"][number]>>();
  for (const s of active) groups.set(block.get(s.id)!, [...(groups.get(block.get(s.id)!) ?? []), s]);
  return [...groups.values()]
    .filter((g) => g.length > 1)
    .map((g) => ({
      id: `equivalent-states:${g.map((s) => s.label).join("/")}`,
      kind: "equivalent-states" as const,
      action: null,
      field: null,
      state: g[0]!.id,
      message: `状態「${g.map((s) => s.label).join("」「")}」は、どの操作・登場人物・入力でも、できる／できないと行き先が同じ。1 つの状態にまとめるか、違いを生む条件を書き忘れていないか`,
    }));
};

const deadEnds = (spec: Spec, graph: Graph): Array<OmissionHint> => {
  if (spec.goals.length === 0) return [];
  const goals = new Set(graph.states.filter((s) => spec.goals.some(([, fn]) => holds(fn, s.values))).map((s) => s.id));
  if (goals.size === 0) return [];
  const moves = graph.transitions.filter((t) => t.from !== t.to);
  const live = new Set(goals);
  for (let changed = true; changed; ) {
    changed = false;
    for (const t of moves) {
      if (live.has(t.to) && !live.has(t.from)) {
        live.add(t.from);
        changed = true;
      }
    }
  }
  // 遷移の一覧ではなく入力ごとの可否からたどる理由: 同じ操作でも入力の例によって行き先が違うことがあり、
  // 手順に入力の例の名前が無いと、そのままシナリオに起こしたときに別の状態へ行ってしまう。
  const steps = graph.availability.filter((r) => r.enabled && r.to !== null && r.to !== r.state);
  const parent = new Map<string, { from: string; step: string }>();
  const queue = graph.states.filter((s) => s.initial).map((s) => s.id);
  const seen = new Set(queue);
  for (let i = 0; i < queue.length; i++) {
    for (const r of steps.filter((x) => x.state === queue[i])) {
      if (seen.has(r.to!)) continue;
      seen.add(r.to!);
      parent.set(r.to!, { from: r.state, step: `${actionTitle(spec, r.action)}（${r.input === null ? r.actor : `${r.actor}、${r.input}`}）` });
      queue.push(r.to!);
    }
  }
  const pathTo = (id: string) => {
    const path: Array<string> = [];
    for (let p = parent.get(id); p !== undefined; p = parent.get(p.from)) path.unshift(p.step);
    return path.join(" → ");
  };
  const goalNames = spec.goals.map(([name]) => name).join("、");
  return graph.states
    .filter((s) => !s.terminal && !live.has(s.id))
    .filter((s) => s.initial || moves.some((t) => t.to === s.id && live.has(t.from)))
    .map((s) => ({
      id: `cannot-reach-goal:${s.label}`,
      kind: "cannot-reach-goal" as const,
      action: null,
      field: null,
      state: s.id,
      message: `状態「${s.label}」は終端ではないのに、目指す状態（${goalNames}）のどれにもたどり着けない。入る手順: ${s.initial ? "（初期状態）" : pathTo(s.id)}`,
    }));
};

const MAX_PERTURBED_STATES = 50;

// 項目の値を 1 つだけ差し替えた状態で操作を実行し直し、可否が変わるかを見る（Leveson の入力の完全性）。
// 差し替えた状態は到達できないこともあるが、ここで知りたいのは「条件がその項目を見ているか」なので構わない。
const unusedFields = (spec: Spec, graph: Graph, options: Pick<ExploreOptions, "bypassEnsure">): Array<OmissionHint> => {
  const states = graph.states.slice(0, MAX_PERTURBED_STATES);
  const fields = [...new Set(states.flatMap((s) => Object.keys(s.values)))];
  // 文字列の項目には、登場人物の属性の値も候補に入れる。authorId のように登場人物と比べる項目は、
  // 到達できる状態では 1 つの値（"alice"）しかとらないことがあり、それだけでは差し替えられないため。
  const actorStrings = spec.actors.flatMap(([, v]) => (isPlainObject(v) ? Object.values(v).filter((x) => typeof x === "string") : []));
  const enabledAt = new Map(graph.availability.map((r) => [JSON.stringify([r.state, r.action, r.actor, r.input]), r.enabled]));
  const bypassFor = (action: string) => (options.bypassEnsure?.action === action ? options.bypassEnsure.reason : null);
  const NO_INPUT: ReadonlyArray<readonly [string | null, ReadonlyArray<unknown>]> = [[null, []]];

  const used = (field: string) => {
    const seen = states.map((s) => s.values[field]);
    const domain = [...new Set([...seen, ...(spec.fields[field] ?? []), ...(seen.some((v) => typeof v === "string") ? actorStrings : [])].map((v) => JSON.stringify(v)))].map(
      (v) => JSON.parse(v) as unknown,
    );
    for (const s of states) {
      for (const value of domain) {
        if (JSON.stringify(value) === JSON.stringify(s.values[field])) continue;
        const perturbed = { ...s.values, [field]: value } as State;
        for (const [action, fn] of spec.actions) {
          for (const [actor, actorValue] of spec.actors) {
            for (const [input, args] of spec.inputs[action] ?? NO_INPUT) {
              const before = enabledAt.get(JSON.stringify([s.id, action, actor, input]));
              if (before === undefined) continue;
              const after = runAction(fn, perturbed, actorValue, args, bypassFor(action)).kind === "ok";
              if (before !== after) return true;
            }
          }
        }
      }
    }
    return false;
  };

  // 関連の項目（ほかのドメインオブジェクトを指す項目）は、データの構造を表すもので、操作の可否に効かないのが普通なので除く。
  const refs = new Set(spec.refs.map((r) => r.field));
  return fields
    .filter((f) => !used(f) && !refs.has(f))
    .map((field) => ({
      id: `unused-field:${field}`,
      kind: "unused-field" as const,
      action: null,
      field,
      message: `状態の項目 ${field} は、値を変えても、どの操作の可否も変わらない。この項目を使う条件を書き忘れていないか`,
    }));
};
