import { isNotAllowed } from "./ensure.ts";
import type { Spec, State } from "./load.ts";
import { canonical, type Finding, type Graph } from "./model.ts";

export interface ExploreOptions {
  readonly maxStates?: number;
}

const DEFAULT_MAX_STATES = 500;

type Outcome =
  | { readonly kind: "ok"; readonly next: State }
  | { readonly kind: "not-allowed"; readonly reason: string }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "invalid-return" };

const run = (fn: Spec["actions"][number][1], state: State, actor: unknown): Outcome => {
  try {
    // structuredClone を渡す理由: 関数が引数を破壊的に変更しても、探索済みの状態が壊れないようにするため。
    const next = (fn as (s: unknown, a: unknown) => unknown)(structuredClone(state), structuredClone(actor));
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

  register(canonical(spec.initial) as State);
  // 幅優先探索の理由: 状態 ID と表の行の並びを「初期状態からの近さ」順に固定し、
  // spec の書き換えで出力の順序が揺れないようにするため（差分レビューの前提）。
  explore: for (let i = 0; i < queue.length; i++) {
    const from = queue[i]!;
    const values = valuesById.get(from)!;
    for (const [action, fn] of spec.actions) {
      for (const [actor, actorValue] of spec.actors) {
        const outcome = run(fn, values, actorValue);
        if (outcome.kind !== "ok") {
          if (outcome.kind === "error") findings.push({ kind: "action-error", action, actor, state: from, message: outcome.message });
          if (outcome.kind === "invalid-return") findings.push({ kind: "invalid-return", action, actor, state: from });
          const reason = outcome.kind === "not-allowed" ? outcome.reason : null;
          availability.push({ state: from, action, actor, enabled: false, to: null, reason });
          continue;
        }
        const to = register(outcome.next, { from, action, actor });
        if (to === undefined) {
          findings.push({ kind: "state-limit", maxStates });
          break explore;
        }
        availability.push({ state: from, action, actor, enabled: true, to, reason: null });
        const key = `${from}|${action}|${to}`;
        const t = transitions.get(key) ?? { from, to, action, actors: [] };
        t.actors.push(actor);
        transitions.set(key, t);
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
  for (const [action] of spec.actions) {
    if (!availability.some((a) => a.action === action && a.enabled)) findings.push({ kind: "never-enabled-action", action });
  }

  return { states, transitions: [...transitions.values()], availability, findings };
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
