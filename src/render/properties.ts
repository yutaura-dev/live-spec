import type { Spec } from "../load.ts";
import type { Property } from "../static.ts";

export interface PropertyRow {
  readonly field: string;
  readonly type: string;
  readonly doc: string;
  /** 状態遷移で変わる・作ったときに決まる・データ・条件で読む・参照（相手）。種類の行と値の行は空 */
  readonly kind: string;
  /** 入れ子の深さ（状態の型の項目が 0） */
  readonly depth: number;
  /** 行の種類: 項目、判別 union の種類、値の一覧の 1 つの値 */
  readonly row: "field" | "variant" | "value";
  /** 型が値オブジェクトの型の項目なら、その値オブジェクトの名前（*.value.ts のファイル名） */
  readonly valueObject?: string;
}

export interface ValueObjectRef {
  readonly name: string;
  readonly typeName: string;
  readonly displayName: string;
}

const valueObjectIn = (type: string, values: ReadonlyArray<ValueObjectRef>): ValueObjectRef | undefined =>
  values.find((v) => new RegExp(`(^|[^\\w$])${v.typeName}($|[^\\w$])`).test(type));

// 値の一覧も、項目の行のすぐ下に 1 値 1 行で並べる。値と説明を横一列に流すと、値が多いときや説明が長いとき、
// どの説明がどの値のものか読み取りにくいため。子の項目や判別 union の種類の行と同じく、木として読めるようにする。
const valueRows = (spec: Spec, docs: Readonly<Record<string, string>> | undefined, values: ReadonlyArray<unknown>, depth: number): Array<PropertyRow> =>
  values.map((v) => {
    const value = String(v);
    return { field: value, type: "", doc: docs?.[value] ?? spec.glossary[value] ?? "", kind: "", depth, row: "value" };
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
    ...valueRows(spec, c.valueDocs, c.values ?? [], depth + 1),
    ...childRows(spec, c.children, depth + 1),
  ]);

// ほかの集約への参照（@ref の項目、型がほかの spec の状態の型の項目）は、データではなく参照として出す。
// 何を指しているかが、表から読めるようにするため。型の名前の項目は、相手の spec が見つかったときだけ参照とする
// （型の名前だけでは、ただの値の型と見分けられないため）。
const kindOf = (spec: Spec, field: string, targetOf: (name: string) => string | null): string => {
  const ref = spec.refs.find((r) => r.field === field);
  const target = ref === undefined ? null : ref.explicit ? ref.target : targetOf(ref.target);
  if (target !== null) return `参照（${target}）`;
  return spec.dataFields.includes(field) ? "データ" : spec.writtenFields.includes(field) ? "状態遷移で変わる" : "作ったときに決まる";
};

export const propertyRows = (
  spec: Spec,
  targetOf: (name: string) => string | null = () => null,
  values: ReadonlyArray<ValueObjectRef> = [],
): Array<PropertyRow> =>
  spec.properties.flatMap((p) => {
    const vo = valueObjectIn(p.type, values);
    return [
    {
      field: p.field,
      type: p.type,
      doc: p.doc ?? "",
      kind: vo === undefined ? kindOf(spec, p.field, targetOf) : `値オブジェクト（${vo.displayName}）`,
      depth: 0,
      row: "field" as const,
      ...(vo === undefined ? {} : { valueObject: vo.name }),
    },
    ...valueRows(spec, spec.valueDocs[p.field], spec.fields[p.field] ?? [], 1),
    ...childRows(spec, p.children, 1),
    ];
  });

/** 値オブジェクトの項目の表の行。値オブジェクトの項目は状態遷移の扱いを持たないので、扱いは空にする */
export const valueObjectRows = (properties: ReadonlyArray<Property>, glossary: Readonly<Record<string, string>> = {}): Array<PropertyRow> => {
  const rows = (children: ReadonlyArray<Property>, depth: number): Array<PropertyRow> =>
    children.flatMap((c) => [
      { field: c.field, type: c.type, doc: c.doc ?? "", kind: "", depth, row: c.variant === true ? ("variant" as const) : ("field" as const) },
      ...(c.values ?? []).map((v) => {
        const value = String(v);
        return { field: value, type: "", doc: c.valueDocs?.[value] ?? glossary[value] ?? "", kind: "", depth: depth + 1, row: "value" as const };
      }),
      ...rows(c.children, depth + 1),
    ]);
  return rows(properties, 0);
};
