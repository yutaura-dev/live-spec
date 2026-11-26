import type { Spec } from "./load.ts";

const firstSentence = (doc: string | undefined): string | null => {
  const s = doc?.split(/[。\n]/)[0]?.trim();
  return s === undefined || s === "" ? null : s;
};

// 型の識別子（status など）の代わりに JSDoc の最初の文を出す理由: 仕様書の読み手はコードを読まない人も含み、
// 英語の項目名を覚えずに読めるようにするため。JSDoc がなければ識別子のまま出す。
export const fieldLabel = (spec: Pick<Spec, "fieldDocs">, field: string): string => firstSentence(spec.fieldDocs[field]) ?? field;

export const actionTitle = (spec: Pick<Spec, "docs">, action: string): string => firstSentence(spec.docs[action]) ?? action;
