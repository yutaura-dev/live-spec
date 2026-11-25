import { isNotAllowed } from "./ensure.ts";
import type { Spec, State } from "./load.ts";
import { canonical, type Finding, type Graph } from "./model.ts";
import { buttonsOf, type SurfaceNode } from "./surface.ts";

export interface ExploreOptions {
  readonly maxStates?: number;
}

const DEFAULT_MAX_STATES = 500;

type Outcome =
  | { readonly kind: "ok"; readonly next: State }
  | { readonly kind: "not-allowed"; readonly reason: string }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "invalid-return" };

const run = (fn: Spec["actions"][number][1], state: State, actor: unknown, args: ReadonlyArray<unknown>): Outcome => {
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

export const explore = (spec: Spec, options: ExploreOptions = {}): Graph => {
  const maxStates = options.maxStates ?? DEFAULT_MAX_STATES;
  const ids = new Map<string, string>();
  const valuesById = new Map<string, State>();
  const queue: Array<string> = [];
  const parents = new Map<string, { from: string; action: string; actor: string }>();
  const violations: Array<{ invariant: string; state: string }> = [];
  const register = (values: State, via?: { from: string; action: string; actor: string }): string | undefined => {
    const key = JSON.stringify(values);
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
  // 幅優先探索の理由: 状態 ID と表の行の並びを「初期状態からの近さ」順に固定し、
  // spec の書き換えで出力の順序が揺れないようにするため（差分レビューの前提）。
  explore: for (let i = 0; i < queue.length; i++) {
    const from = queue[i]!;
    const values = valuesById.get(from)!;
    for (const [action, fn] of runnable) {
      for (const [actor, actorValue] of spec.actors) {
        for (const [input, args] of spec.inputs[action] ?? NO_INPUT) {
          const outcome = run(fn, values, actorValue, args);
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

  const labelOf = labeler([...valuesById.values()]);
  const states = [...valuesById.entries()].map(([id, values]) => ({
    id,
    label: labelOf(values),
    values,
    initial: id === "s0",
    terminal: processed.has(id) && !availability.some((a) => a.state === id && a.enabled),
  }));

  for (const v of violations) findings.push({ kind: "invariant-violation", ...v, path: pathTo(v.state) });
  for (const [field, values] of Object.entries(spec.fields)) {
    for (const value of values) {
      if (!states.some((s) => s.values[field] === value)) findings.push({ kind: "unreachable-value", field, value });
    }
  }
  for (const action of missingInputs) findings.push({ kind: "missing-inputs", action });
  for (const action of Object.keys(spec.inputs)) {
    if (!spec.actions.some(([name]) => name === action)) findings.push({ kind: "unknown-inputs", action });
  }
  for (const [action] of runnable) {
    if (!availability.some((a) => a.action === action && a.enabled)) findings.push({ kind: "never-enabled-action", action });
  }

  const surfaces = spec.surface === null ? [] : checkSurfaces(spec.surface, spec, [...processed], valuesById, availability, findings);

  const scenarios = runScenarios(spec, (values) => ids.get(JSON.stringify(values)) ?? null, findings);
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
    return { ask: q.ask, note: q.note ?? null, action, states: matched };
  });

  const links = spec.links.map((l) => ({ from: l.from?.name ?? null, to: l.to, action: l.action ?? null, label: l.label }));

  return { states, transitions: [...transitions.values()], availability, findings, surfaces, links, questions, scenarios };
};

const show = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));

// シナリオは探索とは別に、初期状態から手順どおりに実行する。探索は「到達できるか」を確かめるが、
// シナリオは「この業務の流れが、この順番で通るか」を名指しで確かめる（受け入れテストの役割）。
const runScenarios = (spec: Spec, idOf: (values: State) => string | null, findings: Array<Finding>): Graph["scenarios"] =>
  spec.scenarios.map(([name, steps]) => {
    let values = canonical(spec.initial) as State;
    const records: Array<Graph["scenarios"][number]["steps"][number]> = [];
    for (const [i, step] of steps.entries()) {
      const action = step.do.name;
      const fail = (reason: string) => {
        records.push({ action, actor: step.by, input: step.input ?? null, from: idOf(values), to: null, ok: false, reason });
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
      const outcome = run(step.do, values, actor[1], args);
      if (outcome.kind !== "ok") {
        fail(outcome.kind === "not-allowed" ? outcome.reason : outcome.kind === "error" ? `例外: ${outcome.message}` : "オブジェクトを返さなかった");
        break;
      }
      const mismatch = Object.entries(step.expect ?? {}).find(([k, v]) => JSON.stringify(canonical(v)) !== JSON.stringify(outcome.next[k]));
      if (mismatch !== undefined) {
        const [k, v] = mismatch;
        fail(`期待: ${k} = ${show(v)}、実際: ${k} = ${show(outcome.next[k])}`);
        break;
      }
      records.push({ action, actor: step.by, input: step.input ?? null, from: idOf(values), to: idOf(outcome.next), ok: true, reason: null });
      values = outcome.next;
    }
    return { name, passed: records.length === steps.length && records.every((r) => r.ok), steps: records };
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
const labeler = (all: ReadonlyArray<State>) => {
  const keys = [...new Set(all.flatMap((v) => Object.keys(v)))]
    .filter((k) => new Set(all.map((v) => JSON.stringify(v[k]))).size > 1)
    .sort((a, b) => rank(all[0]![a]) - rank(all[0]![b]) || a.localeCompare(b));
  return (values: State): string => {
    const parts = keys.flatMap((k) => {
      const v = values[k];
      if (typeof v === "string") return [v];
      if (typeof v === "boolean") return v ? [k] : [];
      return [`${k}=${JSON.stringify(v)}`];
    });
    return parts.length > 0 ? parts.join(" · ") : "初期状態";
  };
};
const rank = (v: unknown) => (typeof v === "string" ? 0 : typeof v === "boolean" ? 1 : 2);
