import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { explore } from "./explore.ts";
import { loadSpec } from "./load.ts";
import { normalize } from "./model.ts";
import { renderHtml } from "./render/html.ts";
import { renderMarkdown } from "./render/markdown.ts";

export type OutputFormat = "markdown" | "json" | "html";

export const specNameOf = (path: string): string => basename(path).replace(/(\.spec)?\.[cm]?ts$/, "");

// import のたびにクエリを変える理由: ESM は同じ URL のモジュールをキャッシュするので、
// --watch で spec を読み直しても古い内容のまま生成されてしまう。クエリが違えば別モジュールとして読み込まれる。
// spec から import しているファイル（共通の型など）は読み直されない点に注意。
let importVersion = 0;

export const generate = async (path: string, format: OutputFormat): Promise<string> => {
  const url = pathToFileURL(resolve(path));
  url.search = `?v=${++importVersion}`;
  const mod = (await import(url.href)) as Record<string, unknown>;
  const spec = loadSpec(specNameOf(path), mod, { source: await readFile(path, "utf8") });
  const graph = explore(spec);
  if (format === "html") return renderHtml(spec, graph);
  if (format === "json") return JSON.stringify(normalize(spec, graph), null, 2);
  return renderMarkdown(spec, graph);
};

export const writeOutput = async (out: string, content: string) => {
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, content.endsWith("\n") ? content : content + "\n");
};
