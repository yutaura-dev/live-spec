import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { explore } from "./explore.ts";
import { loadSpec } from "./load.ts";
import { normalize } from "./model.ts";
import { renderProjectHtml, type DomainObject } from "./render/html.ts";
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

const loadObject = async (path: string): Promise<DomainObject> => {
  const url = pathToFileURL(resolve(path));
  url.search = `?v=${++importVersion}`;
  const mod = (await import(url.href)) as Record<string, unknown>;
  const spec = loadSpec(specNameOf(path), mod, { source: await readFile(path, "utf8") });
  return { spec, graph: explore(spec) };
};

export const generateProject = async (paths: ReadonlyArray<string>, format: OutputFormat, title?: string): Promise<Output> => {
  const objects = await Promise.all(paths.map(loadObject));
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
      ...Object.fromEntries(objects.map((o) => [`${o.spec.name}.md`, renderMarkdown(o.spec, o.graph)])),
    },
  };
};

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
        // 壊れた package.json は無視して、ディレクトリ名にする
      }
      return basename(dir);
    }
    if (dirname(dir) === dir) return basename(dirname(resolve(specPath)));
  }
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
