import type { Spec } from "./load.ts";
import type { Finding } from "./model.ts";
import type { DomainObject } from "./render/html.ts";

export interface Relation {
  readonly from: string;
  readonly to: string;
  /** from の状態の型の、to を指す項目 */
  readonly fields: ReadonlyArray<string>;
  /** to の状態の型の、from を指す項目（向きが逆の関連） */
  readonly back: ReadonlyArray<string>;
  /** 1 つの to に、from がいくつ結びつくか。to から指す項目が無ければ分からない（null） */
  readonly fromMany: boolean | null;
  /** 1 つの from が、to をいくつ持つか */
  readonly toMany: boolean;
}

// 相手は spec の名前（@ref post）でも、状態の型の名前（author: Post）でも探す。
// 型で書く人と、ID の項目に @ref で書く人の両方がいるため。
const targetOf = (objects: ReadonlyArray<DomainObject>, name: string): Spec | undefined =>
  objects.find((o) => o.spec.name === name)?.spec ?? objects.find((o) => o.spec.stateType === name)?.spec;

export const unresolvedRefs = (objects: ReadonlyArray<DomainObject>, spec: Spec): Array<Finding> =>
  spec.refs.filter((r) => r.explicit && targetOf(objects, r.target) === undefined).map((r) => ({ kind: "ref-unresolved", field: r.field, target: r.target }));

// 互いを指す項目（Post の author と User の posts）を 1 本にまとめる理由: ER 図と同じく、1 つの関連の両端として読めるようにするため。
// 別々の 2 本にすると、同じ関連が 2 つあるように見える。
export const projectRelations = (objects: ReadonlyArray<DomainObject>): Array<Relation> => {
  const edges = objects.flatMap(({ spec }) =>
    spec.refs.flatMap((r) => {
      const target = targetOf(objects, r.target);
      return target === undefined || target.name === spec.name ? [] : [{ from: spec.name, to: target.name, ref: r }];
    }),
  );
  const relations: Array<Relation> = [];
  const seen = new Set<string>();
  for (const e of edges) {
    const key = JSON.stringify([e.from, e.to].sort());
    if (seen.has(key)) continue;
    seen.add(key);
    const forward = edges.filter((x) => x.from === e.from && x.to === e.to).map((x) => x.ref);
    const backward = edges.filter((x) => x.from === e.to && x.to === e.from).map((x) => x.ref);
    relations.push({
      from: e.from,
      to: e.to,
      fields: forward.map((r) => r.field),
      back: backward.map((r) => r.field),
      fromMany: backward.length === 0 ? null : backward.some((r) => r.many),
      toMany: forward.some((r) => r.many),
    });
  }
  return relations;
};
