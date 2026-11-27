import type { Spec } from "../load.ts";

export interface PropertyRow {
  readonly field: string;
  readonly type: string;
  readonly doc: string;
  readonly kind: "状態遷移で変わる" | "作ったときに決まる" | "データ";
  readonly values: ReadonlyArray<{ readonly value: string; readonly doc: string | null }>;
}

export const propertyRows = (spec: Spec): Array<PropertyRow> =>
  spec.properties.map((p) => ({
    field: p.field,
    type: p.type,
    doc: p.doc ?? "",
    kind: spec.dataFields.includes(p.field) ? "データ" : spec.writtenFields.includes(p.field) ? "状態遷移で変わる" : "作ったときに決まる",
    values: (spec.fields[p.field] ?? []).map((v) => {
      const value = String(v);
      return { value, doc: spec.valueDocs[p.field]?.[value] ?? spec.glossary[value] ?? null };
    }),
  }));
