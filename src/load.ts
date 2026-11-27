import { SpecError } from "./errors.ts";
import { isNotAllowed } from "./ensure.ts";
import { analyze, type EnsureCall, type FieldRef, type FieldValue, type Property } from "./static.ts";

export type State = Readonly<Record<string, unknown>>;
export type ActionFn = (state: never, actor: never) => unknown;
export type InvariantFn = (state: never) => unknown;
export type FactoryFn = (actor: never, ...input: never[]) => unknown;
export type TransitionInvariantFn = (before: never, after: never) => unknown;
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
  /** spec のファイル名から取った名前。URL・links の to・検査結果の出力に使う */
  readonly name: string;
  /** 仕様書の見出しやタブに出す名前（export const displayName。無ければ name を Title Case にしたもの） */
  readonly displayName: string;
  /** 初期状態。initial を関数（作る操作）で書いたときは、最初に作れた状態（状態の項目の並びと、ほかの検査の代表に使う） */
  readonly initial: State;
  /** 作る操作（export function initial(登場人物, ...入力)）。initial をオブジェクトで書いたときは null */
  readonly factory: FactoryFn | null;
  readonly actors: ReadonlyArray<readonly [name: string, actor: unknown]>;
  readonly actions: ReadonlyArray<readonly [name: string, fn: ActionFn]>;
  readonly invariants: ReadonlyArray<readonly [name: string, fn: InvariantFn]>;
  /** 遷移の不変条件（invariants のうち、引数を 2 つとるもの）。集約のライフサイクルの決まり（終わったら変わらない、など） */
  readonly transitionInvariants: ReadonlyArray<readonly [name: string, fn: TransitionInvariantFn]>;
  /** 目指す状態。たどり着けない状態（袋小路）を見つけるのに使う */
  readonly goals: ReadonlyArray<readonly [name: string, fn: InvariantFn]>;
  readonly inputs: Readonly<Record<string, ReadonlyArray<readonly [label: string, args: ReadonlyArray<unknown>]>>>;
  readonly surface: SurfaceFn | null;
  /** given: シナリオを始める、作ったときに決まる値（{ given: { kind: "wait" }, steps: [...] } と書いたとき） */
  readonly scenarios: ReadonlyArray<readonly [name: string, steps: ReadonlyArray<ScenarioStep>, given?: Readonly<Record<string, unknown>>]>;
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
  /** 条件で読まれる名前。値オブジェクトを文字にするとき、読まれる項目だけを出すのに使う */
  readonly readFields: ReadonlyArray<string>;
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
  "displayName",
]);

const isRecord = (u: unknown): u is Readonly<Record<string, unknown>> =>
  typeof u === "object" && u !== null && !Array.isArray(u);

export interface LoadOptions {
  readonly source?: string;
}

// ファイル名（action-item）から読みやすい名前（Action Item）を作る。仕様書の見出しやタブにファイル名がそのまま出ると、
// 読み手にはコードの識別子に見えるため。略語や日本語の名前は displayName で上書きしてもらう。
export const titleCase = (name: string): string =>
  name
    .split(/[-_\s]+/)
    .filter((w) => w !== "")
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(" ");

export const loadSpec = (name: string, mod: Readonly<Record<string, unknown>>, options: LoadOptions = {}): Spec => {
  const { actors } = mod;
  if (!isRecord(actors)) throw new SpecError(`${name}: 登場人物を表す \`export const actors\` が必要です`);
  const factory = typeof mod.initial === "function" ? (mod.initial as FactoryFn) : null;
  const inputs = inputsOf(mod.inputs);
  const initial = factory === null ? mod.initial : firstCreated(name, factory, Object.entries(actors), inputs.initial);
  if (!isRecord(initial)) throw new SpecError(`${name}: 初期状態を表す \`export const initial\`（オブジェクトか、作る操作の関数）が必要です`);
  const info = options.source === undefined ? undefined : analyze(options.source);
  return {
    name,
    initial,
    factory,
    actors: Object.entries(actors),
    actions: orderActions(
      Object.entries(mod).filter((e): e is [string, ActionFn] => !RESERVED.has(e[0]) && typeof e[1] === "function"),
      info?.order,
    ),
    // 引数の数で見分ける理由: 1 つの状態についての条件と遷移の前後についての条件は、どちらも「いつも成り立つべきこと」で、
    // 書き手が置き場所を迷わないよう同じ invariants に書けるようにするため。export を分けると、どちらに書くかの規約が増える。
    invariants: isRecord(mod.invariants)
      ? Object.entries(mod.invariants).filter((e): e is [string, InvariantFn] => typeof e[1] === "function" && e[1].length < 2)
      : [],
    transitionInvariants: isRecord(mod.invariants)
      ? Object.entries(mod.invariants).filter((e): e is [string, TransitionInvariantFn] => typeof e[1] === "function" && e[1].length >= 2)
      : [],
    stateType: info?.stateType ?? null,
    refs: info?.refs ?? [],
    properties: info?.properties ?? [],
    valueDocs: info?.valueDocs ?? {},
    dataFields: info?.dataFields ?? [],
    creationFields: info?.creationFields ?? [],
    writtenFields: info?.writtenFields ?? [],
    readFields: info?.readFields ?? [],
    displayName: typeof mod.displayName === "string" && mod.displayName !== "" ? mod.displayName : titleCase(name),
    variants: Array.isArray(mod.variants) ? mod.variants.filter(isRecord) : [],
    groupBy: isRecord(mod.diagram) && typeof mod.diagram.groupBy === "string" ? mod.diagram.groupBy : null,
    goals: isRecord(mod.goals) ? Object.entries(mod.goals).filter((e): e is [string, InvariantFn] => typeof e[1] === "function") : [],
    inputs,
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
      ? Object.entries(mod.scenarios).flatMap(([name, value]): Array<readonly [string, ReadonlyArray<ScenarioStep>, Readonly<Record<string, unknown>>?]> => {
          if (Array.isArray(value)) return [[name, value as Array<ScenarioStep>]];
          if (isRecord(value) && Array.isArray(value.steps)) return [[name, value.steps as Array<ScenarioStep>, isRecord(value.given) ? value.given : {}]];
          return [];
        })
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

// 作る操作を読み込むときに一度実行する理由: 状態の項目の並び（状態の名前の順）や、ensure の効く範囲の計算は、
// 代表の初期状態を 1 つ必要とする。探索のたびに選び直すと、探索の結果によって名前の順が変わってしまう。
const firstCreated = (
  name: string,
  factory: FactoryFn,
  actors: ReadonlyArray<readonly [string, unknown]>,
  examples: ReadonlyArray<readonly [string, ReadonlyArray<unknown>]> | undefined,
): unknown => {
  if (factory.length > 1 && examples === undefined) {
    throw new SpecError(`${name}: initial は登場人物のあとに入力をとるので、inputs.initial に入力の例を書く`);
  }
  const reasons: Array<string> = [];
  for (const [, actor] of actors) {
    for (const [, args] of examples ?? [["", []]]) {
      try {
        const created = (factory as (a: unknown, ...rest: Array<unknown>) => unknown)(structuredClone(actor), ...structuredClone(args));
        if (isRecord(created)) return created;
      } catch (e) {
        if (isNotAllowed(e) && !reasons.includes(e.message)) reasons.push(e.message);
      }
    }
  }
  throw new SpecError(`${name}: どの登場人物・入力の例でも作れない（initial が「${reasons.join("」「")}」で止まる）`);
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
