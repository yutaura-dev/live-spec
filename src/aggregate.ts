import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { titleCase } from "./load.ts";
import { importSource } from "./errors.ts";
import type { DomainObject } from "./render/html.ts";

export interface Aggregate {
  /** ファイル名から取った名前（task.aggregate.ts なら task） */
  readonly name: string;
  readonly displayName: string;
  readonly doc: string | null;
  /** ルートの Entity の spec の名前 */
  readonly root: string;
  /** 中の Entity の spec の名前 */
  readonly entities: ReadonlyArray<string>;
  /** 集約をまたぐ決まりの説明。今は実行せず、まだ確かめていない決まりとして出す */
  readonly invariants: ReadonlyArray<string>;
  readonly findings: ReadonlyArray<string>;
}

export const aggregateNameOf = (path: string): string => basename(path).replace(/\.aggregate\.[cm]?ts$/, "");

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

// 集約のファイルには型がないので、静的解析ではなく、最初の JSDoc を集約の説明にする。
const firstDoc = (source: string): string | null => {
  const m = /\/\*\*([\s\S]*?)\*\//.exec(source);
  if (m === null) return null;
  const text = m[1]!
    .split("\n")
    .map((l) => l.replace(/^\s*\*\s?/, "").trim())
    .filter((l) => l !== "")
    .join("\n");
  return text === "" ? null : text;
};

let importVersion = 0;

export const loadAggregate = async (path: string): Promise<Aggregate> => {
  const url = pathToFileURL(resolve(path));
  url.search = `?v=${++importVersion}`;
  const mod = await importSource(url.href);
  const name = aggregateNameOf(path);
  const entities = Array.isArray(mod.entities) ? mod.entities.filter((e): e is string => typeof e === "string") : [];
  return {
    name,
    displayName: typeof mod.displayName === "string" && mod.displayName !== "" ? mod.displayName : titleCase(name),
    doc: firstDoc(await readFile(path, "utf8")),
    root: typeof mod.root === "string" && mod.root !== "" ? mod.root : name,
    entities,
    invariants: isRecord(mod.invariants) ? Object.keys(mod.invariants) : [],
    findings: [],
  };
};

/** 集約の中の Entity として入っている集約（ルートや、どの集約にも入っていない spec では null） */
export const aggregateOfEntity = (aggregates: ReadonlyArray<Aggregate>, name: string): Aggregate | null =>
  aggregates.find((a) => a.entities.includes(name)) ?? null;

export const aggregateOfRoot = (aggregates: ReadonlyArray<Aggregate>, name: string): Aggregate | null =>
  aggregates.find((a) => a.root === name) ?? null;

// 集約の決まりは、spec を全部読んでからでないと確かめられない（ルートや中の Entity は別のファイルにあるため）。
export const resolveAggregates = (objects: ReadonlyArray<DomainObject>, aggregates: ReadonlyArray<Aggregate>): Array<Aggregate> =>
  aggregates.map((a) => {
    const exists = (n: string) => objects.some((o) => o.spec.name === n);
    const members = new Set([a.root, ...a.entities]);
    const findings = [
      ...(exists(a.root) ? [] : [`ルートの「${a.root}」の spec が見つからない`]),
      ...a.entities.flatMap((e) => (exists(e) ? [] : [`中の Entity「${e}」の spec が見つからない`])),
      ...(a.entities.includes(a.root) ? [`ルートの「${a.root}」が、中の Entity にも入っている`] : []),
      ...a.entities.flatMap((e) =>
        aggregates.filter((b) => b !== a && (b.entities.includes(e) || b.root === e)).map((b) => `中の Entity「${e}」が、集約「${b.name}」にも入っている`),
      ),
      // DDD では、集約の外からはルートだけを指す。中の Entity を直接指すと、ルートを通さずに中を変えられてしまうため。
      ...objects
        .filter((o) => !members.has(o.spec.name))
        .flatMap((o) => [
          ...o.graph.links.filter((l) => a.entities.includes(l.to)).map((l) => ({ from: o.spec.name, to: l.to, via: "links" })),
          ...o.spec.refs.filter((r) => r.explicit && a.entities.includes(r.target)).map((r) => ({ from: o.spec.name, to: r.target, via: "@ref" })),
        ])
        .map((x) => `集約の外の ${x.from} が、中の Entity ${x.to} を ${x.via} で指している（外からはルートの ${a.root} を指す）`),
    ];
    return { ...a, findings: [...a.findings, ...findings] };
  });
