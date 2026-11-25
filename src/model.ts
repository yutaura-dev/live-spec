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
]);
export type Finding = typeof Finding.Type;

export const Graph = Schema.Struct({
  states: Schema.Array(ExploredState),
  transitions: Schema.Array(Transition),
  availability: Schema.Array(Availability),
  findings: Schema.Array(Finding),
});
export type Graph = typeof Graph.Type;

export const SpecModel = Schema.Struct({
  name: Schema.String,
  summary: Schema.NullOr(Schema.String),
  fields: Schema.Record(Schema.String, Schema.Array(FieldValue)),
  actors: Schema.Array(Schema.Struct({ name: Schema.String, value: Schema.Unknown })),
  actions: Schema.Array(Schema.Struct({ name: Schema.String, summary: Schema.NullOr(Schema.String) })),
  ...Graph.fields,
});
export type SpecModel = typeof SpecModel.Type;

export const normalize = (spec: Spec, graph: Graph): SpecModel => ({
  name: spec.name,
  summary: spec.stateDoc,
  fields: canonical(spec.fields) as SpecModel["fields"],
  actors: spec.actors.map(([name, value]) => ({ name, value: canonical(value) })),
  actions: spec.actions.map(([name]) => ({ name, summary: spec.docs[name] ?? null })),
  ...graph,
});

// キーを並べ替えて正規化する理由: spec の書き手（主に AI）がオブジェクトの
// キーの順序を変えただけで、意味の変わらない差分が出ないようにするため。
export const canonical = (u: unknown): unknown => {
  if (Array.isArray(u)) return u.map(canonical);
  if (typeof u === "object" && u !== null) {
    return Object.fromEntries(Object.keys(u).sort().map((k) => [k, canonical((u as Record<string, unknown>)[k])]));
  }
  return u;
};
