import type { Spec } from "../load.ts";
import type { Property } from "../static.ts";

export interface PropertyRow {
  readonly field: string;
  readonly type: string;
  readonly doc: string;
  readonly kind: "状態遷移で変わる" | "作ったときに決まる" | "データ" | "条件で読む" | "";
  /** 入れ子の深さ（状態の型の項目が 0） */
  readonly depth: number;
  /** 行の種類: 項目、判別 union の種類、値の一覧の 1 つの値 */
  readonly row: "field" | "variant" | "value";
}

// 値の一覧も、項目の行のすぐ下に 1 値 1 行で並べる。値と説明を横一列に流すと、値が多いときや説明が長いとき、
// どの説明がどの値のものか読み取りにくいため。子の項目や判別 union の種類の行と同じく、木として読めるようにする。
const valueRows = (spec: Spec, field: string, values: ReadonlyArray<unknown>, depth: number): Array<PropertyRow> =>
  values.map((v) => {
    const value = String(v);
    return { field: value, type: "", doc: spec.valueDocs[field]?.[value] ?? spec.glossary[value] ?? "", kind: "", depth, row: "value" };
  });

const childRows = (spec: Spec, children: ReadonlyArray<Property>, depth: number): Array<PropertyRow> =>
  children.flatMap((c) => [
    {
      field: c.field,
      type: c.type,
      doc: c.doc ?? "",
      kind: c.variant === true ? ("" as const) : spec.readFields.includes(c.field) ? ("条件で読む" as const) : ("データ" as const),
      depth,
      row: c.variant === true ? ("variant" as const) : ("field" as const),
    },
    ...valueRows(spec, c.field, c.values ?? [], depth + 1),
    ...childRows(spec, c.children, depth + 1),
  ]);

export const propertyRows = (spec: Spec): Array<PropertyRow> =>
  spec.properties.flatMap((p) => [
    {
      field: p.field,
      type: p.type,
      doc: p.doc ?? "",
      kind: spec.dataFields.includes(p.field) ? ("データ" as const) : spec.writtenFields.includes(p.field) ? ("状態遷移で変わる" as const) : ("作ったときに決まる" as const),
      depth: 0,
      row: "field" as const,
    },
    ...valueRows(spec, p.field, spec.fields[p.field] ?? [], 1),
    ...childRows(spec, p.children, 1),
  ]);
