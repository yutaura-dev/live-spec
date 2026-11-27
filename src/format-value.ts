const DISCRIMINANTS = ["type", "kind", "tag"];

/** オブジェクトの中の項目のうち、状態の名前に出すもの（判別子と、条件で読む項目） */
export const isShownInside = (record: Readonly<Record<string, unknown>>, key: string, read: ReadonlySet<string>): boolean =>
  (DISCRIMINANTS.find((k) => typeof record[k] === "string") === key) || read.has(key);

// 項目の値を、状態の名前・チップ・「通るのは」・シナリオの食い違いの表示に出す文字にする。どこでも同じ書式にするため、
// 値を文字にするときは必ずここを通す（String() では [object Object]、JSON では読めない文字になるため）。
// オブジェクトは、判別子（type など）と、条件で読む項目（read）の値だけを短く出す。条件で読まない項目（データ）は省く。
// read を渡さないときは、全部の項目を出す（ルールの結果やシナリオの食い違いのように、中身を全部見せたいとき）。
export const formatValue = (value: unknown, read?: ReadonlySet<string>): string => {
  if (value === null || value === undefined) return "なし";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `[${value.map((v) => formatValue(v, read)).join(", ")}]`;
  if (typeof value === "object") {
    const record = value as Readonly<Record<string, unknown>>;
    const discriminant = DISCRIMINANTS.find((k) => typeof record[k] === "string");
    const shown = Object.entries(record).filter(([k]) => k !== discriminant && (read === undefined || read.has(k)));
    if (discriminant !== undefined) return [record[discriminant] as string, ...shown.map(([, v]) => formatValue(v, read))].join(":");
    if (shown.length === 0) return Object.keys(record).length === 0 ? "{}" : "{…}";
    return `{ ${shown.map(([k, v]) => `${k}: ${formatValue(v, read)}`).join(", ")} }`;
  }
  return String(value);
};
