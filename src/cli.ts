import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { generate, writeOutput, type OutputFormat } from "./generate.ts";
import { startServer } from "./serve.ts";
import { watchSpec } from "./watch.ts";

export { generate, specNameOf, type OutputFormat } from "./generate.ts";

export interface CliOptions {
  readonly path: string;
  readonly format: OutputFormat;
  readonly out: string | null;
  readonly watch: boolean;
  readonly serve: boolean;
  readonly port: number;
}

const DEFAULT_PORT = 4747;

export const outputFormatOf = (flags: ReadonlyArray<string>): OutputFormat =>
  flags.includes("--html") ? "html" : flags.includes("--json") ? "json" : "markdown";

export const parseCliArgs = (argv: ReadonlyArray<string>): CliOptions => {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      html: { type: "boolean" },
      json: { type: "boolean" },
      out: { type: "string" },
      watch: { type: "boolean" },
      serve: { type: "boolean" },
      port: { type: "string" },
    },
  });
  const path = positionals[0];
  if (path === undefined) throw new Error("spec ファイルのパスを指定してください");
  const out = values.out ?? null;
  const serve = values.serve ?? false;
  const watch = serve || (values.watch ?? false);
  if (watch && !serve && out === null) {
    throw new Error("--watch には --out <file> が必要です（標準出力には繰り返し書き出せないため）");
  }
  const port = values.port === undefined ? DEFAULT_PORT : Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`--port には 0〜65535 の整数を指定してください: ${values.port}`);
  const format = serve || values.html ? "html" : values.json ? "json" : "markdown";
  return { path, format, out, watch, serve, port };
};

const USAGE = "usage: pnpm spec <file.spec.ts> [--html | --json] [--out <file>] [--watch] [--serve [--port <n>]]";

const main = async (argv: ReadonlyArray<string>) => {
  let options: CliOptions;
  try {
    options = parseCliArgs(argv);
  } catch (e) {
    console.error(`${e instanceof Error ? e.message : String(e)}\n${USAGE}`);
    process.exitCode = 2;
    return;
  }
  if (options.serve) {
    const server = await startServer(options.port);
    console.error(`${server.url} で仕様書を配信しています。spec を保存するとブラウザが自動で再読み込みします`);
    watchSpec({ path: options.path, out: options.out, format: "html", onBuilt: (html) => server.update(html) });
    return;
  }
  if (options.watch) {
    watchSpec({ path: options.path, out: options.out, format: options.format });
    return;
  }
  const output = await generate(options.path, options.format);
  if (options.out === null) process.stdout.write(output + "\n");
  else await writeOutput(options.out, output);
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main(process.argv.slice(2));
