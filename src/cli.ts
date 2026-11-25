#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { expandSpecPaths, generateProject, writeProjectOutput, type OutputFormat } from "./generate.ts";
import { startServer } from "./serve.ts";
import { watchSpec } from "./watch.ts";

export { expandSpecPaths, generate, generateProject, specNameOf, type OutputFormat } from "./generate.ts";

export interface CliOptions {
  readonly paths: ReadonlyArray<string>;
  readonly format: OutputFormat;
  readonly out: string | null;
  readonly watch: boolean;
  readonly serve: boolean;
  readonly port: number;
  readonly title: string | null;
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
      title: { type: "string" },
    },
  });
  if (positionals.length === 0) throw new Error("spec ファイル（またはそれを含むディレクトリ）のパスを指定してください");
  const out = values.out ?? null;
  const serve = values.serve ?? false;
  const watch = serve || (values.watch ?? false);
  if (watch && !serve && out === null) {
    throw new Error("--watch には --out <file> が必要です（標準出力には繰り返し書き出せないため）");
  }
  // 組み合わせをエラーにする理由: 片方を黙って無視すると、利用者は意図と違う出力を受け取ったことに気づけない。
  if (values.html && values.json) throw new Error("--html と --json は同時に指定できません");
  if (serve && values.json) throw new Error("--serve と --json は同時に指定できません（--serve は HTML だけを配信します）");
  if (values.port !== undefined && !serve) throw new Error("--port は --serve と一緒に指定してください");
  const port = values.port === undefined ? DEFAULT_PORT : Number(values.port);
  if (values.port?.trim() === "" || !Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`--port には 0〜65535 の整数を指定してください: "${values.port}"`);
  }
  const format = serve || values.html ? "html" : values.json ? "json" : "markdown";
  return { paths: positionals, format, out, watch, serve, port, title: values.title ?? null };
};

const USAGE = "usage: pnpm spec <file.spec.ts | dir>... [--html | --json] [--out <file | dir>] [--watch] [--serve [--port <n>]] [--title <名前>]";

export interface CliIo {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

// 終了コードを返す関数にしている理由: 失敗したときの終わり方（メッセージと終了コード）をテストで確かめるため。
// 監視を始めた場合は、プロセスを終わらせないので null を返す。
export const runCli = async (argv: ReadonlyArray<string>, io: CliIo): Promise<number | null> => {
  let options: CliOptions;
  try {
    options = parseCliArgs(argv);
  } catch (e) {
    io.stderr(`${messageOf(e)}\n${USAGE}\n`);
    return 2;
  }
  if (options.serve) {
    let server;
    try {
      server = await startServer(options.port);
    } catch (e) {
      const inUse = (e as { code?: unknown }).code === "EADDRINUSE";
      io.stderr(
        inUse
          ? `ポート ${options.port} は使用中です。--port で別の番号を指定してください（0 なら空いている番号を使います）\n`
          : `サーバを起動できませんでした: ${messageOf(e)}\n`,
      );
      return 1;
    }
    io.stderr(`${server.url} で仕様書を配信しています。spec を保存するとブラウザが自動で再読み込みします\n`);
    watchSpec({ paths: options.paths, out: options.out, format: "html", title: options.title, onBuilt: (html) => server.update(html) });
    return null;
  }
  if (options.watch) {
    watchSpec({ paths: options.paths, out: options.out, format: options.format, title: options.title });
    return null;
  }
  const paths = expandSpecPaths(options.paths);
  if (paths.length === 0) {
    io.stderr(`spec ファイル（*.spec.ts）が見つかりません: ${options.paths.join(", ")}\n`);
    return 2;
  }
  let output;
  try {
    output = await generateProject(paths, options.format, options.title ?? undefined);
  } catch (e) {
    io.stderr(`生成に失敗しました: ${messageOf(e)}\n`);
    return 1;
  }
  if (options.out !== null) {
    await writeProjectOutput(options.out, output);
    return 0;
  }
  if (output.kind === "files") {
    io.stderr(`ドメインオブジェクトが複数あるので、Markdown はファイルに分けて書き出します。--out <ディレクトリ> を指定してください\n${USAGE}\n`);
    return 2;
  }
  io.stdout(output.content + "\n");
  return 0;
};

// realpath で比べる理由: pnpm などで bin として入れると node_modules/.bin のシンボリックリンク経由で
// 起動され、process.argv[1] がリンクのパスになる。素朴に比べると一致せず、CLI が何もせずに終わる。
export const isMain = (moduleUrl: string, argv1: string | undefined): boolean => {
  if (argv1 === undefined) return false;
  try {
    // 両側とも realpath にそろえる。macOS の /var → /private/var のように、モジュール自身のパスも
    // シンボリックリンクを含むことがあるため。
    return pathToFileURL(realpathSync(fileURLToPath(moduleUrl))).href === pathToFileURL(realpathSync(argv1)).href;
  } catch {
    return false;
  }
};

if (isMain(import.meta.url, process.argv[1])) {
  const code = await runCli(process.argv.slice(2), {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
  });
  if (code !== null) process.exitCode = code;
}
