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
  Schema.Struct({
    kind: Schema.Literal("surface-action-not-allowed"),
    state: Schema.String,
    actor: Schema.String,
    action: Schema.String,
  }),
  Schema.Struct({ kind: Schema.Literal("surface-action-missing"), state: Schema.String, actor: Schema.String, action: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("surface-error"), state: Schema.String, actor: Schema.String, message: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("unknown-inputs"), action: Schema.String }),
  Schema.Struct({
    kind: Schema.Literal("invariant-violation"),
    invariant: Schema.String,
    state: Schema.String,
    path: Schema.Array(Schema.Struct({ action: Schema.String, actor: Schema.String })),
  }),
]);
export type Finding = typeof Finding.Type;

export const Graph = Schema.Struct({
  states: Schema.Array(ExploredState),
  transitions: Schema.Array(Transition),
  availability: Schema.Array(Availability),
  findings: Schema.Array(Finding),
  surfaces: Schema.Array(Schema.Struct({ state: Schema.String, actor: Schema.String, surface: Schema.Unknown })),
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