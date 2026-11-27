import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { explore } from "./explore.ts";
import { checkEnsures } from "./mutation.ts";
import { findOmissionHints } from "./omission.ts";
import { UNTESTED, unguardedId } from "./render/review.ts";
import { unresolvedRefs } from "./relations.ts";
import { linkTests } from "./test-links.ts";
import { loadSpec } from "./load.ts";
import { normalize } from "./model.ts";
import { renderErrorHtml, renderProjectHtml, type DomainObject } from "./render/html.ts";
import { renderIndexMarkdown, renderMarkdown } from "./render/markdown.ts";

export type OutputFormat = "markdown" | "json" | "html";

export type Output =
  | { readonly kind: "text"; readonly content: string }
  | { readonly kind: "files"; readonly files: Readonly<Record<string, string>> };

export const specNameOf = (path: string): string => basename(path).replace(/(\.spec)?\.[cm]?ts$/, "");

// ディレクトリを渡せるようにする理由: 1 つの spec ファイルを 1 つのドメインオブジェクトとして扱うので、
// プロジェクトの仕様は複数のファイルになる。specs/ のようなディレクトリをまとめて渡せる方が自然。
export const expandSpecPaths = (paths: ReadonlyArray<string>): Array<string> =>
  paths.flatMap((p) => {
    let isDir = false;
    try {
      isDir = statSync(p).isDirectory();
    } catch {
      return [p];
    }
    if (!isDir) return [p];
    return (readdirSync(p, { recursive: true }) as Array<string>)
      .filter((f) => f.endsWith(".spec.ts") && !basename(f).startsWith("."))
      .sort()
      .map((f) => join(p, f));
  });

// import のたびにクエリを変える理由: ESM は同じ URL のモジュールをキャッシュするので、
// --watch で spec を読み直しても古い内容のまま生成されてしまう。クエリが違えば別モジュールとして読み込まれる。
// spec から import しているファイル（共通の型など）は読み直されない点に注意。
let importVersion = 0;

export interface LoadObjectOptions {
  readonly name?: string;
  readonly source?: string;
}

// 名前とソースを外から渡せるようにしている理由: 差分を取るとき、git から取り出した spec を一時ファイルに書いて
// 読み込むので、ファイル名からではなく元の spec の名前で扱う必要があるため。
export const loadObject = async (path: string, options: LoadObjectOptions = {}): Promise<DomainObject> => {
  const url = pathToFileURL(resolve(path));
  url.search = `?v=${++importVersion}`;
  const mod = (await import(url.href)) as Record<string, unknown>;
  const spec = loadSpec(options.name ?? specNameOf(path), mod, { source: options.source ?? (await readFile(path, "utf8")) });
  const graph = explore(spec);
  const ensures = checkEnsures(spec, graph);
  const omissions = findOmissionHints(spec, graph);
  const known = new Set([...omissions.map((h) => h.id), ...ensures.filter((e) => e.verdict === "unguarded").map(unguardedId)]);
  const unmatched = Object.keys(spec.reviewed)
    // テストのない条件は、テストを結んだときにしか出ないので、ここでは照らさない（linkTests で照らす）。
    .filter((id) => !known.has(id) && !id.startsWith(UNTESTED))
    .map((id) => ({ kind: "reviewed-unmatched" as const, id }));
  return { spec, graph: { ...graph, ensures, omissions, findings: [...graph.findings, ...unmatched] } };
};

export const generateProject = async (
  paths: ReadonlyArray<string>,
  format: OutputFormat,
  title?: string,
  tests: ReadonlyArray<string> = [],
): Promise<Output> => {
  const resolved = resolveLinks(await Promise.all(paths.map((p) => loadObject(p))));
  const objects = tests.length === 0 ? resolved : linkTests(resolved, tests);
  const names = objects.map((o) => o.spec.name);
  const duplicated = names.find((n, i) => names.indexOf(n) !== i);
  if (duplicated !== undefined) throw new Error(`ドメインオブジェクトの名前が重複しています: ${duplicated}（spec のファイル名を変えてください）`);
  const projectTitle = title ?? (objects.length === 1 ? objects[0]!.spec.name : projectNameOf(paths[0]!));

  if (format === "html") return { kind: "text", content: await renderProjectHtml(objects, { title: projectTitle }) };
  if (format === "json") {
    const models = objects.map((o) => normalize(o.spec, o.graph));
    return { kind: "text", content: JSON.stringify(models.length === 1 ? models[0] : { objects: models }, null, 2) };
  }
  if (objects.length === 1) return { kind: "text", content: renderMarkdown(objects[0]!.spec, objects[0]!.graph) };
  return {
    kind: "files",
    files: {
      "README.md": renderIndexMarkdown(objects, projectTitle),
      ...Object.fromEntries(objects.map((o) => [`${o.spec.name}.md`, renderMarkdown(o.spec, o.graph, objects)])),
    },
  };
};

// つながりの名前の誤りをプロジェクトを読み込んだ時点で調べる理由: 相手のドメインオブジェクトは別の spec にあり、
// 1 つの spec を探索するだけでは確かめられないため。spec が 1 つのときは相手がいないので調べない。
export const resolveLinks = (objects: ReadonlyArray<DomainObject>): Array<DomainObject> =>
  objects.map((o) => {
    if (objects.length < 2) return o;
    const unresolved = o.graph.links.filter((l) => {
      const target = objects.find((t) => t.spec.name === l.to);
      return target === undefined || (l.action !== null && !target.spec.actions.some(([n]) => n === l.action));
    });
    const refs = unresolvedRefs(objects, o.spec);
    if (unresolved.length + refs.length === 0) return o;
    return {
      spec: o.spec,
      graph: {
        ...o.graph,
        findings: [...o.graph.findings, ...unresolved.map((l) => ({ kind: "link-unresolved" as const, to: l.to, action: l.action })), ...refs],
      },
    };
  });

// プロジェクトの名前を package.json から取る理由: spec を置くディレクトリは specs/ のような汎用の名前が多く、
// ディレクトリ名をタイトルにすると、どのプロジェクトの仕様書なのかが分からないため。
const projectNameOf = (specPath: string): string => {
  for (let dir = dirname(resolve(specPath)); ; dir = dirname(dir)) {
    const pkg = join(dir, "package.json");
    if (existsSync(pkg)) {
      try {
        const name = (JSON.parse(readFileSync(pkg, "utf8")) as { name?: unknown }).name;
        if (typeof name === "string" && name !== "") return name;
      } catch {
        // 壊れた package.json で生成全体を止めない。タイトルはディレクトリ名で十分に代わりになるため。
      }
      return basename(dir);
    }
    if (dirname(dir) === dir) return basename(dirname(resolve(specPath)));
  }
};

// 失敗したことを出力そのものに書く理由: Markdown や JSON を前回の内容のまま残すと、読む人が古い仕様を
// 最新だと取り違えるため（specs/watch-session.spec.ts の未決事項だったもの）。HTML はエラーページにする。
export const failureOutput = (format: OutputFormat, paths: ReadonlyArray<string>, error: unknown): Output => {
  const message = error instanceof Error ? error.message : String(error);
  if (format === "html") return { kind: "text", content: renderErrorHtml(paths.length === 1 ? specNameOf(paths[0]!) : "仕様書", error) };
  if (format === "json") return { kind: "text", content: JSON.stringify({ error: message }, null, 2) };
  const notice = [
    "# 仕様書を生成できませんでした",
    "",
    "spec ファイルを直して保存すると、自動で生成し直します。",
    "",
    "```",
    message,
    "```",
    "",
  ];
  if (paths.length === 1) return { kind: "text", content: notice.join("\n") };
  return {
    kind: "files",
    files: { "README.md": [...notice, "このディレクトリのほかのファイルは、前回の生成のままです。", ""].join("\n") },
  };
};

export const generate = async (path: string, format: OutputFormat): Promise<string> => {
  const out = await generateProject([path], format);
  if (out.kind !== "text") throw new Error("1 つの spec からは 1 つのテキストが生成されるはず");
  return out.content;
};

const withNewline = (content: string) => (content.endsWith("\n") ? content : content + "\n");

export const writeOutput = async (out: string, content: string) => {
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, withNewline(content));
};

export const writeProjectOutput = async (out: string, output: Output) => {
  if (output.kind === "text") return writeOutput(out, output.content);
  await mkdir(out, { recursive: true });
  await Promise.all(Object.entries(output.files).map(([name, content]) => writeFile(join(out, name), withNewline(content))));
};
