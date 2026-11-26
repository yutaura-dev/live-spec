import { Schema } from "effect";
import type { Spec } from "./load.ts";

export const ExploredState = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  values: Schema.Record(Schema.String, Schema.Unknown),
  initial: Schema.Boolean,
  terminal: Schema.Boolean,
});

export const Transition = Schema.Struct({
  from: Schema.String,
  to: Schema.String,
  action: Schema.String,
  actors: Schema.Array(Schema.String),
});

export const Availability = Schema.Struct({
  state: Schema.String,
  action: Schema.String,
  actor: Schema.String,
  input: Schema.NullOr(Schema.String),
  enabled: Schema.Boolean,
  to: Schema.NullOr(Schema.String),
  reason: Schema.NullOr(Schema.String),
});

const FieldValue = Schema.Union([Schema.String, Schema.Boolean]);

export const Finding = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("unreachable-value"), field: Schema.String, value: FieldValue }),
  Schema.Struct({ kind: Schema.Literal("never-enabled-action"), action: Schema.String }),
  Schema.Struct({
    kind: Schema.Literal("action-error"),
    action: Schema.String,
    actor: Schema.String,
    state: Schema.String,
    message: Schema.String,
  }),
  Schema.Struct({ kind: Schema.Literal("invalid-return"), action: Schema.String, actor: Schema.String, state: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("state-limit"), maxStates: Schema.Number }),
  Schema.Struct({ kind: Schema.Literal("missing-inputs"), action: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("question-unmatched"), ask: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("question-scenario-unknown"), ask: Schema.String, scenario: Schema.String }),
  Schema.Struct({
    kind: Schema.Literal("decision-mismatch"),
    decision: Schema.String,
    row: Schema.Number,
    expected: Schema.String,
    actual: Schema.String,
  }),
  Schema.Struct({ kind: Schema.Literal("decision-error"), decision: Schema.String, row: Schema.Number, message: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("link-unresolved"), to: Schema.String, action: Schema.NullOr(Schema.String) }),
  Schema.Struct({ kind: Schema.Literal("scenario-failed"), scenario: Schema.String, step: Schema.Number, reason: Schema.String }),
  Schema.Struct({
    kind: Schema.Literal("surface-action-not-allowed"),
    state: Schema.String,
    actor: Schema.String,
    action: Schema.String,
  }),
  Schema.Struct({ kind: Schema.Literal("surface-action-missing"), state: Schema.String, actor: Schema.String, action: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("surface-error"), state: Schema.String, actor: Schema.String, message: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("unknown-inputs"), action: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("reviewed-unmatched"), id: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("goal-unreachable"), goal: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("evidence-missing"), action: Schema.String, evidence: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("evidence-out-of-range"), action: Schema.String, evidence: Schema.String, lines: Schema.Number }),
  Schema.Struct({ kind: Schema.Literal("evidence-moved"), action: Schema.String, evidence: Schema.String, location: Schema.String, moved: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("evidence-changed"), action: Schema.String, evidence: Schema.String, location: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("evidence-unlocked"), action: Schema.String, evidence: Schema.String, location: Schema.String }),
  Schema.Struct({
    kind: Schema.Literal("invariant-violation"),
    invariant: Schema.String,
    state: Schema.String,
    path: Schema.Array(Schema.Struct({ action: Schema.String, actor: Schema.String })),
  }),
]);
export type Finding = typeof Finding.Type;

// ensure を 1 つ外して探索し直した結果。caught: 外すと何か（不変条件・シナリオ・画面・実行時エラー）が気づく。
// unguarded: 振る舞いは変わるのに何も気づかない（その条件の意図が、ほかのどこにも書かれていない）。
// no-effect: 外しても振る舞いが変わらない（ほかの条件と重なっている）。
export const EnsureCheck = Schema.Struct({
  action: Schema.String,
  reason: Schema.String,
  line: Schema.NullOr(Schema.Number),
  verdict: Schema.Literals(["caught", "unguarded", "no-effect"]),
  caughtBy: Schema.Array(Schema.String),
  effects: Schema.Array(
    Schema.Struct({ state: Schema.String, action: Schema.String, actor: Schema.String, input: Schema.NullOr(Schema.String), after: Schema.String }),
  ),
  newStates: Schema.Array(Schema.String),
  /** 実際に通るのはどんなときか（その ensure だけを効かせて実行して求めたもの） */
  passes: Schema.String,
  /** 後ろの条件のために型を絞る ensure か */
  narrowing: Schema.Boolean,
});
export type EnsureCheck = typeof EnsureCheck.Type;

// spec を実行した結果から見つけた、書き忘れていそうな条件の候補。id は reviewed で「意図どおり」と答えるときのキー。
export const OmissionHint = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literals([
    "anyone-can",
    "anytime",
    "ignores-input",
    "same-for-similar-actors",
    "indistinguishable-example",
    "indistinguishable-actor",
    "unused-field",
    "cannot-reach-goal",
  ]),
  action: Schema.NullOr(Schema.String),
  field: Schema.NullOr(Schema.String),
  /** 状態についての候補（袋小路の入口など）の、その状態の id */
  state: Schema.optionalKey(Schema.String),
  message: Schema.String,
});
export type OmissionHint = typeof OmissionHint.Type;

export const Graph = Schema.Struct({
  states: Schema.Array(ExploredState),
  transitions: Schema.Array(Transition),
  availability: Schema.Array(Availability),
  findings: Schema.Array(Finding),
  surfaces: Schema.Array(Schema.Struct({ state: Schema.String, actor: Schema.String, surface: Schema.Unknown })),
  decisions: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      columns: Schema.Array(Schema.String),
      rows: Schema.Array(
        Schema.Struct({ input: Schema.Unknown, result: Schema.Unknown, expect: Schema.Unknown, ok: Schema.Boolean }),
      ),
    }),
  ),
  links: Schema.Array(
    Schema.Struct({ from: Schema.NullOr(Schema.String), to: Schema.String, action: Schema.NullOr(Schema.String), label: Schema.String }),
  ),
  questions: Schema.Array(
    Schema.Struct({
      ask: Schema.String,
      note: Schema.NullOr(Schema.String),
      action: Schema.NullOr(Schema.String),
      states: Schema.Array(Schema.String),
      scenario: Schema.optionalKey(Schema.String),
    }),
  ),
  ensures: Schema.optionalKey(Schema.Array(EnsureCheck)),
  omissions: Schema.optionalKey(Schema.Array(OmissionHint)),
  scenarios: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      passed: Schema.Boolean,
      steps: Schema.Array(
        Schema.Struct({
          action: Schema.String,
          actor: Schema.String,
          input: Schema.NullOr(Schema.String),
          from: Schema.NullOr(Schema.String),
          to: Schema.NullOr(Schema.String),
          ok: Schema.Boolean,
          reason: Schema.NullOr(Schema.String),
          denied: Schema.Boolean,
        }),
      ),
    }),
  ),
});
export type Graph = typeof Graph.Type;

// 正規化モデルでは availability を「状態 × 操作」ごとにまとめる理由: 1 件ずつ書き出すと
// 状態 × 操作 × 登場人物 × 入力の数だけ並び、入力の例が多い spec では JSON が 1MB を超える。
// 結果ごとにまとめ、さらに登場人物ごとに「その人の入力すべて（"*"）」か「入力の名前の一覧」を書く。
// 全員が同じ結果なら cases そのものを "*" にする。
export const CompactAvailability = Schema.Struct({
  state: Schema.String,
  action: Schema.String,
  outcomes: Schema.Array(
    Schema.Struct({
      enabled: Schema.Boolean,
      to: Schema.NullOr(Schema.String),
      reason: Schema.NullOr(Schema.String),
      cases: Schema.Union([
        Schema.Literal("*"),
        Schema.Record(Schema.String, Schema.Union([Schema.Literal("*"), Schema.Array(Schema.String)])),
      ]),
    }),
  ),
});

export const SpecModel = Schema.Struct({
  name: Schema.String,
  summary: Schema.NullOr(Schema.String),
  fields: Schema.Record(Schema.String, Schema.Array(FieldValue)),
  actors: Schema.Array(Schema.Struct({ name: Schema.String, value: Schema.Unknown })),
  actions: Schema.Array(Schema.Struct({ name: Schema.String, summary: Schema.NullOr(Schema.String) })),
  inputs: Schema.Record(Schema.String, Schema.Array(Schema.String)),
  ...Graph.fields,
  availability: Schema.Array(CompactAvailability),
});
export type SpecModel = typeof SpecModel.Type;

export const normalize = (spec: Spec, graph: Graph): SpecModel => ({
  name: spec.name,
  summary: spec.stateDoc,
  fields: canonical(spec.fields) as SpecModel["fields"],
  actors: spec.actors.map(([name, value]) => ({ name, value: canonical(value) })),
  actions: spec.actions.map(([name]) => ({ name, summary: spec.docs[name] ?? null })),
  inputs: Object.fromEntries(Object.entries(spec.inputs).map(([action, examples]) => [action, examples.map(([label]) => label)])),
  ...graph,
  availability: compactAvailability(graph.availability),
});

const compactAvailability = (availability: Graph["availability"]): SpecModel["availability"] => {
  const byStateAction = new Map<string, Array<Graph["availability"][number]>>();
  for (const a of availability) {
    const key = JSON.stringify([a.state, a.action]);
    byStateAction.set(key, [...(byStateAction.get(key) ?? []), a]);
  }
  return [...byStateAction.values()].map((entries) => {
    const inputsOf = (actor: string) => entries.filter((a) => a.actor === actor).map((a) => a.input);
    const outcomes = new Map<string, { enabled: boolean; to: string | null; reason: string | null; entries: typeof entries }>();
    for (const a of entries) {
      const key = JSON.stringify([a.enabled, a.to, a.reason]);
      const o = outcomes.get(key) ?? { enabled: a.enabled, to: a.to, reason: a.reason, entries: [] };
      o.entries.push(a);
      outcomes.set(key, o);
    }
    const list = [...outcomes.values()];
    return {
      state: entries[0]!.state,
      action: entries[0]!.action,
      outcomes: list.map(({ entries: mine, ...o }) => {
        if (list.length === 1) return { ...o, cases: "*" as const };
        const cases: Record<string, "*" | Array<string>> = {};
        for (const actor of [...new Set(mine.map((a) => a.actor))]) {
          const inputs = mine.filter((a) => a.actor === actor).map((a) => a.input);
          cases[actor] = inputs.length === inputsOf(actor).length ? "*" : inputs.map((i) => i ?? "");
        }
        return { ...o, cases };
      }),
    };
  });
};

// キーを並べ替えて正規化する理由: spec の書き手（主に AI）がオブジェクトの
// キーの順序を変えただけで、意味の変わらない差分が出ないようにするため。
export const canonical = (u: unknown): unknown => {
  if (Array.isArray(u)) return u.map(canonical);
  if (typeof u === "object" && u !== null) {
    return Object.fromEntries(Object.keys(u).sort().map((k) => [k, canonical((u as Record<string, unknown>)[k])]));
  }
  return u;
};