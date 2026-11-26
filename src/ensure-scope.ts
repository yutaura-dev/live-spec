import { withOnlyEnsure } from "./ensure.ts";
import { runAction } from "./explore.ts";
import { fieldLabel } from "./labels.ts";
import type { Spec } from "./load.ts";
import type { Graph } from "./model.ts";

export interface EnsureScope {
  /** 何によって通る・止まるが決まるか */
  readonly dimension: "state" | "actor" | "input" | "relation" | "mixed" | "none" | "always";
  /** 通るのがどんなときかを、人が理由の文と見比べられる言葉で表したもの */
  readonly passes: string;
}

const MAX_STATES = 200;
const MAX_LISTED = 4;

interface Cell {
  readonly state: Graph["states"][number];
  readonly actor: string;
  readonly actorValue: unknown;
  readonly input: string | null;
  readonly blocked: boolean;
}

const isPlainObject = (u: unknown): u is Readonly<Record<string, unknown>> => typeof u === "object" && u !== null && !Array.isArray(u);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const uniformBy = (cells: ReadonlyArray<Cell>, keyOf: (c: Cell) => string) => {
  const result = new Map<string, boolean>();
  for (const c of cells) {
    const known = result.get(keyOf(c));
    if (known !== undefined && known !== c.blocked) return null;
    result.set(keyOf(c), c.blocked);
  }
  return result;
};

const ordered = <A>(values: Iterable<A>, preferred: ReadonlyArray<unknown> | undefined) => {
  const list = [...values];
  return preferred === undefined ? list : list.sort((a, b) => preferred.indexOf(a) - preferred.indexOf(b));
};

export const ensureScope = (spec: Spec, graph: Graph, action: string, reason: string): EnsureScope => {
  const fn = spec.actions.find(([name]) => name === action)?.[1];
  if (fn === undefined) throw new Error(`操作 ${action} は spec にない`);
  const inputs: ReadonlyArray<readonly [string | null, ReadonlyArray<unknown>]> = spec.inputs[action] ?? [[null, []]];
  const cells: Array<Cell> = [];
  for (const state of graph.states.slice(0, MAX_STATES)) {
    for (const [actor, actorValue] of spec.actors) {
      for (const [input, args] of inputs) {
        const outcome = withOnlyEnsure(reason, () => runAction(fn, state.values, actorValue, args, null));
        cells.push({ state, actor, actorValue, input, blocked: outcome.kind === "not-allowed" && outcome.reason === reason });
      }
    }
  }

  if (cells.every((c) => !c.blocked)) return { dimension: "none", passes: "到達できるどの場合も通る（この条件で止まることがない）" };
  if (cells.every((c) => c.blocked)) return { dimension: "always", passes: "到達できるどの場合も止まる" };

  // 関係を先に調べる理由: 所有者の条件は、到達できる状態で持ち主が 1 人しかいないと「その人のとき」とも読めてしまう。
  // 「持ち主と同じとき」のほうが、理由の文（「作った人だけ」）と見比べやすい。
  // initial に書いた順に試す理由: 到達できる状態で連動している項目（status と dispatch など）は、どちらでも
  // 言い表せる。書き手が先に書いた、読み手に見せたい項目で言い表すほうが、理由の文と見比べやすい。
  const declared = Object.keys(spec.initial);
  const fields = [...new Set([...declared, ...cells.flatMap((c) => Object.keys(c.state.values))])].filter((f) =>
    cells.some((c) => f in c.state.values),
  );
  const actorKeys = [...new Set(cells.flatMap((c) => (isPlainObject(c.actorValue) ? Object.keys(c.actorValue) : [])))];
  for (const field of fields) {
    for (const key of actorKeys) {
      const equal = (c: Cell) => isPlainObject(c.actorValue) && same(c.state.values[field], c.actorValue[key]);
      if (!cells.some(equal) || cells.every(equal)) continue;
      if (cells.every((c) => c.blocked === !equal(c))) return { dimension: "relation", passes: `${field} が登場人物の ${key} と同じとき` };
      if (cells.every((c) => c.blocked === equal(c))) return { dimension: "relation", passes: `${field} が登場人物の ${key} と違うとき` };
    }
  }

  const byState = uniformBy(cells, (c) => c.state.id);
  if (byState !== null) {
    const pass = graph.states.filter((s) => byState.get(s.id) === false);
    const block = graph.states.filter((s) => byState.get(s.id) === true);
    for (const field of fields) {
      const passValues = new Set(pass.map((s) => JSON.stringify(s.values[field])));
      if (block.some((s) => passValues.has(JSON.stringify(s.values[field])))) continue;
      const values = ordered(
        [...passValues].map((v) => JSON.parse(v) as unknown),
        spec.fields[field],
      );
      return { dimension: "state", passes: `${fieldLabel(spec, field)} が ${values.map(String).join(", ")} のとき` };
    }
    return { dimension: "state", passes: `${pass.map((s) => s.label).join(", ")} のとき` };
  }
  const byActor = uniformBy(cells, (c) => c.actor);
  if (byActor !== null) {
    return { dimension: "actor", passes: `${spec.actors.map(([name]) => name).filter((n) => byActor.get(n) === false).join(", ")} のとき` };
  }
  const byInput = uniformBy(cells, (c) => c.input ?? "");
  if (byInput !== null) {
    return { dimension: "input", passes: `入力が ${inputs.map(([label]) => label ?? "").filter((l) => byInput.get(l) === false).join(", ")} のとき` };
  }
  const passing = cells.filter((c) => !c.blocked);
  const listed = passing.slice(0, MAX_LISTED).map((c) => [c.state.label, c.actor, ...(c.input === null ? [] : [c.input])].join("・"));
  return { dimension: "mixed", passes: `${listed.join("、")}${passing.length > MAX_LISTED ? ` ほか ${passing.length - MAX_LISTED} 通り` : ""} のとき` };
};
