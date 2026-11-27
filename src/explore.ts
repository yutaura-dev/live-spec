import { isNotAllowed, withEnsureBypassed } from "./ensure.ts";
import { formatValue } from "./format-value.ts";
import type { Spec, State } from "./load.ts";
import { canonical, type Finding, type Graph } from "./model.ts";
import { buttonsOf, type SurfaceNode } from "./surface.ts";

export interface ExploreOptions {
  readonly maxStates?: number;
  /** この操作の、この理由の ensure を外して探索する（ensure のミューテーション） */
  readonly bypassEnsure?: { readonly action: string; readonly reason: string };
}

const DEFAULT_MAX_STATES = 500;

type Outcome =
  | { readonly kind: "ok"; readonly next: State }
  | { readonly kind: "not-allowed"; readonly reason: string }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "invalid-return" };

export const runAction = (
  fn: Spec["actions"][number][1],
  state: State,
  actor: unknown,
  args: ReadonlyArray<unknown>,
  bypassReason: string | null,
): Outcome => {
  if (bypassReason !== null) return withEnsureBypassed(bypassReason, () => runAction(fn, state, actor, args, null));
  try {
    // structuredClone を渡す理由: 関数が引数を破壊的に変更しても、探索済みの状態が壊れないようにするため。
    const next = (fn as (s: unknown, a: unknown, ...rest: Array<unknown>) => unknown)(
      structuredClone(state),
      structuredClone(actor),
      ...structuredClone(args),
    );
    if (typeof next !== "object" || next === null || Array.isArray(next)) return { kind: "invalid-return" };
    return { kind: "ok", next: canonical(next) as State };
  } catch (e) {
    if (isNotAllowed(e)) return { kind: "not-allowed", reason: e.message };
    return { kind: "error", message: e instanceof Error ? e.message : String(e) };
  }
};

// 例外を違反として扱う理由: 不変条件の関数が想定外の状態で落ちること自体が、
// その状態が書き手の想定を外れている（＝不変条件を満たすと言えない）ことを示すため。
const invariantHolds = (holds: Spec["invariants"][number][1], values: State): boolean => {
  try {
    return Boolean((holds as (s: unknown) => unknown)(structuredClone(values)));
  } catch {
    return false;
  }
};

type BypassFor = (action: string) => string | null;

export const explore = (spec: Spec, options: ExploreOptions = {}): Graph => {
  const maxStates = options.maxStates ?? DEFAULT_MAX_STATES;
  const bypassFor: BypassFor = (action) => (options.bypassEnsure?.action === action ? options.bypassEnsure.reason : null);
  const ids = new Map<string, string>();
  const valuesById = new Map<string, State>();
  const queue: Array<string> = [];
  const parents = new Map<string, { from: string; action: string; actor: string }>();
  const violations: Array<{ invariant: string; state: string }> = [];
  // データの項目（題名や手順の並びのように、振る舞いに効かない値）は、状態の見分けに使わない。値の数だけ状態が増えて、
  // 図が読めなくなるため。実行は、データの項目も含めた値のまま続ける（画面の表示に使うため）。
  // 値の一覧を持つデータの項目（手間・並べ方など）は、どの操作も書き換えないので値が変わらず、状態を増やさない。
  // 見分けに残しておけば、操作の関数を別のファイルに置いて読み書きを見つけられなかったときにも、状態を誤ってまとめない。
  const dataFields = new Set(spec.dataFields);
  const unkeyed = new Set(spec.dataFields.filter((f) => spec.fields[f] === undefined));
  const keyOf = (values: State) => JSON.stringify(Object.fromEntries(Object.entries(values).filter(([k]) => !unkeyed.has(k))));
  const register = (values: State, via?: { from: string; action: string; actor: string }): string | undefined => {
    const key = keyOf(values);
    const known = ids.get(key);
    if (known !== undefined) return known;
    if (ids.size >= maxStates) return undefined;
    const id = `s${ids.size}`;
    ids.set(key, id);
    valuesById.set(id, values);
    queue.push(id);
    if (via !== undefined) parents.set(id, via);
    for (const [invariant, holds] of spec.invariants) {
      if (!invariantHolds(holds, values)) violations.push({ invariant, state: id });
    }
    return id;
  };
  // 幅優先探索で最初に見つけた親をたどるので、得られる手順は初期状態からの最短手順になる。
  const pathTo = (id: string) => {
    const steps: Array<{ action: string; actor: string }> = [];
    for (let p = parents.get(id); p !== undefined; p = parents.get(p.from)) steps.unshift({ action: p.action, actor: p.actor });
    return steps;
  };

  const transitions = new Map<string, { from: string; to: string; action: string; actors: Array<string> }>();
  const availability: Array<Graph["availability"][number]> = [];
  const findings: Array<Finding> = [];
  const processed = new Set<string>();

  // 3 つ目以降の引数がある操作は、inputs に例がなければ実行しない。
  // undefined を渡して実行すると TypeError などが「仕様のバグ」として大量に出て、本当の原因が埋もれるため。
  const missingInputs = spec.actions.filter(([name, fn]) => fn.length > 2 && spec.inputs[name] === undefined).map(([name]) => name);
  const runnable = spec.actions.filter(([name]) => !missingInputs.includes(name));
  const NO_INPUT: ReadonlyArray<readonly [string | null, ReadonlyArray<unknown>]> = [[null, []]];

  register(canonical(spec.initial) as State);
  // 作ったときに決まる値（種類・担当など、作ったあと変わらないが振る舞いを変える値）は、initial の 1 つの値だけでは
  // ほかの値の振る舞いを確かめられない。項目ごとに 1 つずつ値を変えた初期状態も探索する。全部の組み合わせにしないのは、
  // 項目が増えると掛け算で状態の数の上限を超えるため。組み合わせで振る舞いが変わるものは variants に書いてもらう。
  for (const field of spec.creationFields) {
    for (const value of spec.fields[field] ?? []) {
      if (value !== (spec.initial as State)[field]) register(canonical({ ...spec.initial, [field]: value }) as State);
    }
  }
  for (const variant of spec.variants) register(canonical({ ...spec.initial, ...variant }) as State);
  const initials = new Set(valuesById.keys());
  // 幅優先探索の理由: 状態 ID と表の行の並びを「初期状態からの近さ」順に固定し、
  // spec の書き換えで出力の順序が揺れないようにするため（差分レビューの前提）。
  explore: for (let i = 0; i < queue.length; i++) {
    const from = queue[i]!;
    const values = valuesById.get(from)!;
    for (const [action, fn] of runnable) {
      for (const [actor, actorValue] of spec.actors) {
        for (const [input, args] of spec.inputs[action] ?? NO_INPUT) {
          const outcome = runAction(fn, values, actorValue, args, bypassFor(action));
          if (outcome.kind !== "ok") {
            if (outcome.kind === "error") findings.push({ kind: "action-error", action, actor, state: from, message: outcome.message });
            if (outcome.kind === "invalid-return") findings.push({ kind: "invalid-return", action, actor, state: from });
            const reason = outcome.kind === "not-allowed" ? outcome.reason : null;
            availability.push({ state: from, action, actor, input, enabled: false, to: null, reason });
            continue;
          }
          const to = register(outcome.next, { from, action, actor });
          if (to === undefined) {
            findings.push({ kind: "state-limit", maxStates });
            break explore;
          }
          availability.push({ state: from, action, actor, input, enabled: true, to, reason: null });
          const key = `${from}|${action}|${to}`;
          const t = transitions.get(key) ?? { from, to, action, actors: [] };
          if (!t.actors.includes(actor)) t.actors.push(actor);
          transitions.set(key, t);
        }
      }
    }
    processed.add(from);
  }

  const labelOf = labeler([...valuesById.values()], Object.keys(spec.initial), dataFields, new Set(spec.readFields));
  const states = [...valuesById.entries()].map(([id, values]) => ({
    id,
    label: labelOf(values),
    values,
    initial: initials.has(id),
    terminal: processed.has(id) && !availability.some((a) => a.state === id && a.enabled),
  }));

  for (const v of violations) findings.push({ kind: "invariant-violation", ...v, path: pathTo(v.state) });
  for (const [field, values] of Object.entries(spec.fields)) {
    if (dataFields.has(field)) continue;
    for (const value of values) {
      if (!states.some((s) => s.values[field] === value)) findings.push({ kind: "unreachable-value", field, value });
    }
  }
  for (const [goal, holds] of spec.goals) {
    if (!states.some((s) => invariantHolds(holds, s.values))) findings.push({ kind: "goal-unreachable", goal });
  }
  for (const action of missingInputs) findings.push({ kind: "missing-inputs", action });
  for (const action of Object.keys(spec.inputs)) {
    if (!spec.actions.some(([name]) => name === action)) findings.push({ kind: "unknown-inputs", action });
  }
  for (const [action] of runnable) {
    if (!availability.some((a) => a.action === action && a.enabled)) findings.push({ kind: "never-enabled-action", action });
  }

  const surfaces = spec.surface === null ? [] : checkSurfaces(spec.surface, spec, [...processed], valuesById, availability, findings);

  const scenarios = runScenarios(spec, (values) => ids.get(keyOf(values)) ?? null, findings, bypassFor);
  const questions = spec.questions.map((q) => {
    const about = q.about;
    const action = typeof about === "function" ? about.name : null;
    const matched =
      about === undefined || typeof about === "function"
        ? []
        : states
            .filter((s) => Object.entries(about).every(([k, v]) => JSON.stringify(canonical(v)) === JSON.stringify(s.values[k])))
            .map((s) => s.id);
    if (about !== undefined && typeof about !== "function" && matched.length === 0) findings.push({ kind: "question-unmatched", ask: q.ask });
    if (q.scenario !== undefined && !spec.scenarios.some(([name]) => name === q.scenario)) {
      findings.push({ kind: "question-scenario-unknown", ask: q.ask, scenario: q.scenario });
    }
    return { ask: q.ask, note: q.note ?? null, action, states: matched, ...(q.scenario === undefined ? {} : { scenario: q.scenario }) };
  });

  const decisions = spec.decisions.map(([name, d]) => {
    const columns = [...new Set(d.cases.flatMap((c) => (typeof c.input === "object" && c.input !== null ? Object.keys(c.input) : ["入力"])))];
    const rows = d.cases.map((c, i) => {
      let result: unknown;
      try {
        result = (d.decide as (input: unknown) => unknown)(structuredClone(c.input));
      } catch (e) {
        findings.push({ kind: "decision-error", decision: name, row: i + 1, message: e instanceof Error ? e.message : String(e) });
        return { input: c.input, result: null, expect: c.expect ?? null, ok: false };
      }
      const ok = !("expect" in c) || JSON.stringify(canonical(c.expect)) === JSON.stringify(canonical(result));
      if (!ok) findings.push({ kind: "decision-mismatch", decision: name, row: i + 1, expected: formatValue(c.expect), actual: formatValue(result) });
      return { input: c.input, result, expect: "expect" in c ? c.expect : null, ok };
    });
    return { name, columns, rows };
  });
  const links = spec.links.map((l) => ({ from: l.from?.name ?? null, to: l.to, action: l.action ?? null, label: l.label }));

  return { states, transitions: [...transitions.values()], availability, findings, surfaces, decisions, links, questions, scenarios };
};



// シナリオは探索とは別に、初期状態から手順どおりに実行する。探索は「到達できるか」を確かめるが、
// シナリオは「この業務の流れが、この順番で通るか」を名指しで確かめる（受け入れテストの役割）。
const runScenarios = (
  spec: Spec,
  idOf: (values: State) => string | null,
  findings: Array<Finding>,
  bypassFor: BypassFor,
): Graph["scenarios"] =>
  spec.scenarios.map(([name, steps, given]) => {
    let values = canonical({ ...spec.initial, ...given }) as State;
    const records: Array<Graph["scenarios"][number]["steps"][number]> = [];
    const head = given === undefined ? {} : { given };
    // given で始められるのは、作ったときに決まる値だけ。状態遷移で変わる値から始めると、そこへ至る手順を飛ばした
    // シナリオになり、業務の流れとして読めなくなるため。探索していない始め方は、検査の結果と食い違うので断る。
    const invalid = Object.keys(given ?? {}).filter((k) => !spec.creationFields.includes(k));
    const describeGiven = (g: Readonly<Record<string, unknown>>) => Object.entries(g).map(([k, v]) => `${k}: ${formatValue(v)}`).join("、");
    const startError =
      invalid.length > 0
        ? `given に書けるのは、作ったときに決まる値（${spec.creationFields.join("・") || "なし"}）だけ。${invalid.join("・")} は書けない`
        : given !== undefined && idOf(values) === null
          ? `given の組み合わせ（${describeGiven(given)}）は探索していない。export const variants に足す`
          : null;
    if (startError !== null) {
      findings.push({ kind: "scenario-failed", scenario: name, step: 0, reason: startError });
      return { name, passed: false, ...head, steps: [] };
    }
    for (const [i, step] of steps.entries()) {
      const action = step.do.name;
      const fail = (reason: string) => {
        records.push({ action, actor: step.by, input: step.input ?? null, from: idOf(values), to: null, ok: false, reason, denied: step.denied !== undefined });
        findings.push({ kind: "scenario-failed", scenario: name, step: i + 1, reason });
      };
      const actor = spec.actors.find(([n]) => n === step.by);
      if (actor === undefined) {
        fail(`登場人物「${step.by}」は actors にない`);
        break;
      }
      if (!spec.actions.some(([n]) => n === action)) {
        fail(`操作「${action}」はこの spec にない`);
        break;
      }
      const examples = spec.inputs[action];
      const args = step.input === undefined ? [] : examples?.find(([label]) => label === step.input)?.[1];
      if (args === undefined) {
        fail(`入力の例「${step.input}」は inputs にない`);
        break;
      }
      if (step.input === undefined && step.do.length > 2) {
        fail("この操作には入力の例（input）を指定する");
        break;
      }
      const outcome = runAction(step.do, values, actor[1], args, bypassFor(action));
      if (step.denied !== undefined) {
        if (outcome.kind === "ok") {
          fail("断られるはずが、実行できた");
          break;
        }
        if (outcome.kind !== "not-allowed") {
          fail(outcome.kind === "error" ? `例外: ${outcome.message}` : "オブジェクトを返さなかった");
          break;
        }
        if (typeof step.denied === "string" && outcome.reason !== step.denied) {
          fail(`断られる理由が違う: 期待「${step.denied}」、実際「${outcome.reason}」`);
          break;
        }
        const here = idOf(values);
        records.push({ action, actor: step.by, input: step.input ?? null, from: here, to: here, ok: true, reason: outcome.reason, denied: true });
        continue;
      }
      if (outcome.kind !== "ok") {
        fail(outcome.kind === "not-allowed" ? outcome.reason : outcome.kind === "error" ? `例外: ${outcome.message}` : "オブジェクトを返さなかった");
        break;
      }
      const mismatch = Object.entries(step.expect ?? {}).find(([k, v]) => JSON.stringify(canonical(v)) !== JSON.stringify(outcome.next[k]));
      if (mismatch !== undefined) {
        const [k, v] = mismatch;
        fail(`期待: ${k} = ${formatValue(v)}、実際: ${k} = ${formatValue(outcome.next[k])}`);
        break;
      }
      records.push({ action, actor: step.by, input: step.input ?? null, from: idOf(values), to: idOf(outcome.next), ok: true, reason: null, denied: false });
      values = outcome.next;
    }
    return { name, passed: records.length === steps.length && records.every((r) => r.ok), ...head, steps: records };
  });

// 画面のボタンと探索の結果を突き合わせる。画面と状態遷移が同じ spec から作られているので、
// 「押しても実行できないボタン」「実行できるのに画面から辿れない操作」を機械的に見つけられる。
const checkSurfaces = (
  surface: NonNullable<Spec["surface"]>,
  spec: Spec,
  states: ReadonlyArray<string>,
  valuesById: ReadonlyMap<string, State>,
  availability: Graph["availability"],
  findings: Array<Finding>,
): Graph["surfaces"] => {
  const result: Array<Graph["surfaces"][number]> = [];
  for (const state of states) {
    for (const [actor, actorValue] of spec.actors) {
      let node: SurfaceNode | null | undefined;
      try {
        node = (surface as (s: unknown, a: unknown) => SurfaceNode | null | undefined)(
          structuredClone(valuesById.get(state)!),
          structuredClone(actorValue),
        );
      } catch (e) {
        findings.push({ kind: "surface-error", state, actor, message: e instanceof Error ? e.message : String(e) });
        continue;
      }
      // null は「この人に見える画面はない」（API を呼ばないワーカーなど）。記録も検査もしない。
      if (node === null || node === undefined) continue;
      result.push({ state, actor, surface: node });
      const allowed = new Set(availability.filter((a) => a.state === state && a.actor === actor && a.enabled).map((a) => a.action));
      const buttons = buttonsOf(node).filter((b) => b.action !== undefined);
      const shown = new Set(buttons.filter((b) => b.disabled !== true).map((b) => b.action!));
      for (const action of shown) {
        if (!allowed.has(action)) findings.push({ kind: "surface-action-not-allowed", state, actor, action });
      }
      // ボタンの欠落を確かめるのは UI の画面（ui.screen）だけ。API の応答や CLI の出力には
      // ボタンという概念がないので、操作に対応する要素がなくても欠落とは言えない。
      if (node.kind !== "screen") continue;
      for (const action of allowed) {
        if (!shown.has(action)) findings.push({ kind: "surface-action-missing", state, actor, action });
      }
    }
  }
  return result;
};

// ラベルに「状態によって値が変わる項目」だけを使う理由: authorId のように
// どの状態でも同じ値の項目まで並べると、状態を区別する情報が埋もれるため。
// 文字列の項目を先に並べるのは、status のような主たる区分を先頭に見せるため。
// initial に書いた順に並べる理由: 書き手は、読み手に最初に見せたい項目を先に書く。
// 状態の値そのもの（canonical）はキーを並べ替えて持つので、その順番は使わない。
const labeler = (all: ReadonlyArray<State>, declared: ReadonlyArray<string>, excluded: ReadonlySet<string> = new Set(), read: ReadonlySet<string> = new Set()) => {
  const position = (k: string) => (declared.includes(k) ? declared.indexOf(k) : declared.length);
  const keys = [...new Set(all.flatMap((v) => Object.keys(v)))]
    .filter((k) => !excluded.has(k) && new Set(all.map((v) => JSON.stringify(v[k]))).size > 1)
    .sort((a, b) => position(a) - position(b) || a.localeCompare(b));
  return (values: State): string => {
    const parts = keys.flatMap((k) => {
      const v = values[k];
      if (typeof v === "string") return [v];
      if (typeof v === "boolean") return v ? [k] : [];
      if (typeof v === "object" && v !== null && !Array.isArray(v)) return [formatValue(v, read)];
      return [`${k}=${formatValue(v, read)}`];
    });
    return parts.length > 0 ? parts.join(" · ") : "初期状態";
  };
};
