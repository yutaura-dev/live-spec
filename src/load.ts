import { analyze, type FieldValue } from "./static.ts";

export type State = Readonly<Record<string, unknown>>;
export type ActionFn = (state: never, actor: never) => unknown;
export type InvariantFn = (state: never) => unknown;
export type SurfaceFn = (state: never, actor: never) => unknown;

export interface Spec {
  readonly name: string;
  readonly initial: State;
  readonly actors: ReadonlyArray<readonly [name: string, actor: unknown]>;
  readonly actions: ReadonlyArray<readonly [name: string, fn: ActionFn]>;
  readonly invariants: ReadonlyArray<readonly [name: string, fn: InvariantFn]>;
  readonly inputs: Readonly<Record<string, ReadonlyArray<readonly [label: string, args: ReadonlyArray<unknown>]>>>;
  readonly surface: SurfaceFn | null;
  readonly docs: Readonly<Record<string, string>>;
  readonly fields: Readonly<Record<string, ReadonlyArray<FieldValue>>>;
  readonly stateDoc: string | null;
}

const RESERVED = new Set(["initial", "actors", "invariants", "inputs", "surface"]);

const isRecord = (u: unknown): u is Readonly<Record<string, unknown>> =>
  typeof u === "object" && u !== null && !Array.isArray(u);

export interface LoadOptions {
  readonly source?: string;
}

export const loadSpec = (name: string, mod: Readonly<Record<string, unknown>>, options: LoadOptions = {}): Spec => {
  const { initial, actors } = mod;
  if (!isRecord(initial)) throw new Error(`${name}: 初期状態を表す \`export const initial\` が必要です`);
  if (!isRecord(actors)) throw new Error(`${name}: 登場人物を表す \`export const actors\` が必要です`);
  const info = options.source === undefined ? undefined : analyze(options.source);
  return {
    name,
    initial,
    actors: Object.entries(actors),
    actions: orderActions(
      Object.entries(mod).filter((e): e is [string, ActionFn] => !RESERVED.has(e[0]) && typeof e[1] === "function"),
      info?.order,
    ),
    invariants: isRecord(mod.invariants)
      ? Object.entries(mod.invariants).filter((e): e is [string, InvariantFn] => typeof e[1] === "function")
      : [],
    inputs: inputsOf(mod.inputs),
    surface: typeof mod.surface === "function" ? (mod.surface as SurfaceFn) : null,
    docs: info?.docs ?? {},
    fields: info?.fields ?? {},
    stateDoc: info?.stateDoc ?? null,
  };
};

// ソースの順で並べる理由: ES のモジュール名前空間オブジェクトはキーを名前順に並べるので、
// import した結果からは書かれた順が分からない。仕様書では業務の流れ（edit → submit → publish）の
// 順に操作を見せたいので、構文解析で得た export の順を使う。
// ソースがないときに名前順にするのは、実行環境（Node と Vitest など）によって順序が変わらないようにするため。
const inputsOf = (u: unknown): Spec["inputs"] => {
  if (!isRecord(u)) return {};
  return Object.fromEntries(
    Object.entries(u).flatMap(([action, examples]) =>
      isRecord(examples)
        ? [[action, Object.entries(examples).filter((e): e is [string, ReadonlyArray<unknown>] => Array.isArray(e[1]))]]
        : [],
    ),
  );
};

const orderActions = (actions: Array<[string, ActionFn]>, order: ReadonlyArray<string> | undefined) => {
  const byName = actions.sort(([a], [b]) => a.localeCompare(b));
  if (order === undefined) return byName;
  const position = (name: string) => {
    const i = order.indexOf(name);
    return i === -1 ? Number.POSITIVE_INFINITY : i;
  };
  return byName.sort(([a], [b]) => position(a) - position(b));
};
