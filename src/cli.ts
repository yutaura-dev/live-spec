import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { pathToFileURL } from "node:url";
import { explore } from "./explore.ts";
import { loadSpec } from "./load.ts";
import { normalize } from "./model.ts";
import { renderMarkdown } from "./render/markdown.ts";

export const specNameOf = (path: string): string => basename(path).replace(/(\.spec)?\.[cm]?ts$/, "");

const main = async (argv: ReadonlyArray<string>) => {
  const [path, ...flags] = argv;
  if (path === undefined) {
    console.error("usage: pnpm spec <file.spec.ts> [--json]");
    process.exitCode = 2;
    return;
  }
  const mod = (await import(pathToFileURL(path).href)) as Record<string, unknown>;
  const spec = loadSpec(specNameOf(path), mod, { source: await readFile(path, "utf8") });
  const graph = explore(spec);
  const output = flags.includes("--json") ? JSON.stringify(normalize(spec, graph), null, 2) : renderMarkdown(spec, graph);
  process.stdout.write(output + "\n");
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main(process.argv.slice(2));
