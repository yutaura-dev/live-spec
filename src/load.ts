import { analyze, type EnsureCall, type FieldRef, type FieldValue, type Property } from "./static.ts";

export type State = Readonly<Record<string, unknown>>;
export type ActionFn = (state: never, actor: never) => unknown;
export type InvariantFn = (state: never) => unknown;
export type SurfaceFn = (state: never, actor: never) => unknown;

export interface Question {
  readonly ask: string;
  readonly note?: string;
  /** このシナリオについての未決事項（今の動きを写しただけで、正しいと決めていないシナリオ）。シナリオの名前で書く */
  readonly scenario?: string;
  readonly about?: ActionFn | Readonly<Record<string, unknown>>;
}

export interface Link {
  readonly from?: ActionFn;
  readonly to: string;
  readonly action?: string;
  readonly label: string;
}

export interface Decision {
  readonly decide: (input: never) => unknown;
  readonly cases: ReadonlyArray<{ readonly input: unknown; readonly expect?: unknown }>;
}

export interface ScenarioStep {
  readonly do: ActionFn;
  readonly by: string;
  readonly input?: string;
  readonly expect?: Readonly<Record<string, unknown>>;
  /** この手順は断られるはず。文字列なら、その理由で断られるはず */
  readonly denied?: string | true;
}

export interface Spec {
  readonly name: string;
  readonly initial: State;
  readonly actors: ReadonlyArray<readonly [name: string, actor: unknown]>;
  readonly actions: ReadonlyArray<readonly [name: string, fn: ActionFn]>;
  readonly invariants: ReadonlyArray<readonly [name: string, fn: InvariantFn]>;
  /** 目指す状態。たどり着けない状態（袋小路）を見つけるのに使う */
  readonly goals: ReadonlyArray<readonly [name: string, fn: InvariantFn]>;
  readonly inputs: Readonly<Record<string, ReadonlyArray<readonly [label: string, args: ReadonlyArray<unknown>]>>>;
  readonly surface: SurfaceFn | null;
  readonly scenarios: ReadonlyArray<readonly [name: string, steps: ReadonlyArray<ScenarioStep>]>;
  readonly questions: ReadonlyArray<Question>;
  readonly links: ReadonlyArray<Link>;
  readonly decisions: ReadonlyArray<readonly [name: string, decision: Decision]>;
  readonly docs: Readonly<Record<string, string>>;
  readonly fieldDocs: Readonly<Record<string, string>>;
  /** 操作ごとの ensure（静的解析で読んだもの。ソースがなければ空） */
  readonly ensures: Readonly<Record<string, ReadonlyArray<EnsureCall>>>;
  readonly glossary: Readonly<Record<string, string>>;
  /** 確かめてほしい点のうち、人や AI が「意図どおり」と答えたもの（キーは候補の id、値はその理由） */
  readonly reviewed: Readonly<Record<string, string>>;
  readonly fields: Readonly<Record<string, ReadonlyArray<FieldValue>>>;
  readonly stateDoc: string | null;
  /** 要約の図で、状態をまとめる項目（export const diagram = { groupBy: "status" }）。無ければ最初の文字列の項目 */
  readonly groupBy: string | null;
  /** 状態の型の名前。ほかの spec の項目がこの spec を指しているかを見分けるのに使う */
  readonly stateType: string | null;
  /** 状態の型の項目のうち、ほかのドメインオブジェクトを指すかもしれないもの */
  readonly refs: ReadonlyArray<FieldRef>;
  /** 状態の型のすべての項目（プロパティの表に出す） */
  readonly properties: ReadonlyArray<Property>;
  /** 値ごとの説明。項目 → 値 → 説明 */
  readonly valueDocs: Readonly<Record<string, Readonly<Record<string, string>>>>;
  /** データの項目（状態の見分けと名前に使わない） */
  readonly dataFields: ReadonlyArray<string>;
  /** 作ったときに決まる値の項目（値ごとに初期状態を作って探索する） */
  readonly creationFields: ReadonlyArray<string>;
  /** どれかの操作が書き換える項目 */
  readonly writtenFields: ReadonlyArray<string>;
  /** 初期状態に足す組み合わせ（export const variants = [{ kind: "wait", assignee: "claude" }]） */
  readonly variants: ReadonlyArray<Readonly<Record<string, unknown>>>;
}

const RESERVED = new Set([
  "initial",
  "actors",
  "invariants",
  "inputs",
  "surface",
  "scenarios",
  "questions",
  "links",
  "glossary",
  "decisions",
  "reviewed",
  "goals",
  "diagram",
  "variants",
]);

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
    stateType: info?.stateType ?? null,
    refs: info?.refs ?? [],
    properties: info?.properties ?? [],
    valueDocs: info?.valueDocs ?? {},
    dataFields: info?.dataFields ?? [],
    creationFields: info?.creationFields ?? [],
    writtenFields: info?.writtenFields ?? [],
    variants: Array.isArray(mod.variants) ? mod.variants.filter(isRecord) : [],
    groupBy: isRecord(mod.diagram) && typeof mod.diagram.groupBy === "string" ? mod.diagram.groupBy : null,
    goals: isRecord(mod.goals) ? Object.entries(mod.goals).filter((e): e is [string, InvariantFn] => typeof e[1] === "function") : [],
    inputs: inputsOf(mod.inputs),
    surface: typeof mod.surface === "function" ? (mod.surface as SurfaceFn) : null,
    questions: Array.isArray(mod.questions)
      ? mod.questions.filter((q): q is Question => isRecord(q) && typeof q.ask === "string")
      : [],
    decisions: isRecord(mod.decisions)
      ? Object.entries(mod.decisions).filter(
          (e): e is [string, Decision] => isRecord(e[1]) && typeof e[1].decide === "function" && Array.isArray(e[1].cases),
        )
      : [],
    links: Array.isArray(mod.links)
      ? mod.links.filter((l): l is Link => isRecord(l) && typeof l.to === "string" && typeof l.label === "string")
      : [],
    scenarios: isRecord(mod.scenarios)
      ? Object.entries(mod.scenarios).filter((e): e is [string, Array<ScenarioStep>] => Array.isArray(e[1]))
      : [],
    docs: info?.docs ?? {},
    fieldDocs: info?.fieldDocs ?? {},
    ensures: info?.ensures ?? {},
    reviewed: isRecord(mod.reviewed)
      ? Object.fromEntries(Object.entries(mod.reviewed).filter((e): e is [string, string] => typeof e[1] === "string"))
      : {},
    glossary: isRecord(mod.glossary)
      ? Object.fromEntries(Object.entries(mod.glossary).filter((e): e is [string, string] => typeof e[1] === "string"))
      : {},
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
