import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { titleCase } from "./load.ts";
import { importSource, SpecError } from "./errors.ts";
import { analyze, type Property } from "./static.ts";

export interface ValueObject {
  /** ファイル名から取った名前（place.value.ts なら place） */
  readonly name: string;
  readonly displayName: string;
  readonly typeName: string;
  readonly doc: string | null;
  readonly properties: ReadonlyArray<Property>;
  /** 正しい値の決まり（invariants の説明） */
  readonly invariants: ReadonlyArray<string>;
  /** 例ごとに、決まりを確かめた結果。broken は破った決まり */
  readonly examples: ReadonlyArray<{ readonly name: string; readonly valid: boolean; readonly ok: boolean; readonly broken: ReadonlyArray<string> }>;
  readonly findings: ReadonlyArray<string>;
}

type Rule = (value: unknown) => unknown;

export const valueNameOf = (path: string): string => basename(path).replace(/\.value\.[cm]?ts$/, "");

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

// 決まりの関数が例外を投げたら、その決まりを破ったとみなす。正しくない値で中を読みにいって落ちるのは、
// 値が決まりを満たしていないことの表れなので、検査を止めずに結果として示す。
const holds = (rule: Rule, value: unknown): boolean => {
  try {
    return rule(value) === true;
  } catch {
    return false;
  }
};

let importVersion = 0;

// 値オブジェクトにはライフサイクルがない（変えるときは別の値に取り替える）ので、状態遷移は探索しない。
// 確かめるのは、値そのものの決まり（invariants）が、正しい例では満たされ、正しくない例では破られることだけ。
export const loadValueObject = async (path: string): Promise<ValueObject> => {
  const url = pathToFileURL(resolve(path));
  url.search = `?v=${++importVersion}`;
  const mod = await importSource(url.href);
  const info = analyze(await readFile(path, "utf8"));
  const name = valueNameOf(path);
  const wanted = titleCase(name).replace(/\s+/g, "");
  const type = info.exportedTypes.find((t) => t.name === wanted) ?? info.exportedTypes[0];
  if (type === undefined) throw new SpecError(`${name}: 値オブジェクトの型（export type ${wanted}）が必要です`);
  const rules = isRecord(mod.invariants) ? Object.entries(mod.invariants).filter((e): e is [string, Rule] => typeof e[1] === "function") : [];
  const groups = isRecord(mod.examples) ? mod.examples : {};
  const examples = (["valid", "invalid"] as const).flatMap((kind) =>
    Object.entries(isRecord(groups[kind]) ? groups[kind] : {}).map(([example, value]) => {
      const broken = rules.filter(([, rule]) => !holds(rule, value)).map(([rule]) => rule);
      const valid = kind === "valid";
      return { name: example, valid, ok: valid ? broken.length === 0 : broken.length > 0, broken };
    }),
  );
  const findings = examples.flatMap((e) =>
    e.ok
      ? []
      : e.valid
        ? [`正しい例「${e.name}」が、決まり「${e.broken.join("」「")}」を満たさない`]
        : [`正しくない例「${e.name}」が、どの決まりも破らない（決まりの書き漏れか、例の誤り）`],
  );
  return {
    name,
    displayName: typeof mod.displayName === "string" && mod.displayName !== "" ? mod.displayName : type.name,
    typeName: type.name,
    doc: type.doc,
    properties: type.properties,
    invariants: rules.map(([rule]) => rule),
    examples,
    findings,
  };
};
