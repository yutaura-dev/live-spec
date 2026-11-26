#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { findTsc, typecheck } from "./check.ts";
import { expandSpecPaths, generateProject, loadObject, resolveLinks, specNameOf, writeOutput, writeProjectOutput, type OutputFormat } from "./generate.ts";
import { describeFinding } from "./render/markdown.ts";
import { reviewItems } from "./render/review.ts";
import { diffProject } from "./project-diff.ts";
import { renderDiffHtml } from "./render/diff-html.ts";
import { renderDiffMarkdown } from "./render/diff-markdown.ts";
import { startServer } from "./serve.ts";
import { registerSpecLoader } from "./spec-loader.ts";
import { installSkills } from "./skills.ts";
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

const USAGE = "usage: live-spec <file.spec.ts | dir>... [--html | --json] [--out <file | dir>] [--watch] [--serve [--port <n>]] [--title <名前>]";

const wantsHelp = (argv: ReadonlyArray<string>) => argv.includes("--help") || argv.includes("-h");

export interface CliIo {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

// 終了コードを返す関数にしている理由: 失敗したときの終わり方（メッセージと終了コード）をテストで確かめるため。
// 監視を始めた場合は、プロセスを終わらせないので null を返す。
const DIFF_USAGE =
  "usage: live-spec diff <file.spec.ts | dir>... [--base <リビジョン>]（既定は HEAD） [--head <リビジョン>]（省くと作業ツリー） [--html | --json] [--out <file>]";

const runDiff = async (argv: ReadonlyArray<string>, io: CliIo): Promise<number> => {
  if (wantsHelp(argv)) {
    io.stdout(`${DIFF_USAGE}\n`);
    return 0;
  }
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: { base: { type: "string" }, head: { type: "string" }, html: { type: "boolean" }, json: { type: "boolean" }, out: { type: "string" } },
    });
  } catch (e) {
    io.stderr(`${messageOf(e)}\n${DIFF_USAGE}\n`);
    return 2;
  }
  if (parsed.positionals.length === 0) {
    io.stderr(`比べる spec ファイル（またはディレクトリ）を指定してください\n${DIFF_USAGE}\n`);
    return 2;
  }
  if (parsed.values.html && parsed.values.json) {
    io.stderr(`--html と --json は同時に指定できません\n${DIFF_USAGE}\n`);
    return 2;
  }
  let result;
  try {
    result = await diffProject({
      paths: parsed.positionals,
      base: parsed.values.base ?? "HEAD",
      ...(parsed.values.head === undefined ? {} : { head: parsed.values.head }),
    });
  } catch (e) {
    io.stderr(`差分を取れませんでした: ${messageOf(e)}\n`);
    return 1;
  }
  const output = parsed.values.html
    ? await renderDiffHtml(result)
    : parsed.values.json
      ? JSON.stringify(
          { base: result.base, head: result.head, objects: result.objects.map((o) => ({ name: o.name, status: o.status, diff: o.diff })) },
          null,
          2,
        )
      : renderDiffMarkdown(result);
  if (parsed.values.out === undefined) io.stdout(output.endsWith("\n") ? output : output + "\n");
  else await writeOutput(parsed.values.out, output);
  return 0;
};

const CHECK_USAGE = "usage: live-spec check <file.spec.ts | dir>... [--cwd <dir>]（typescript を探すディレクトリ。既定は今のディレクトリ）";

const indent = (text: string) =>
  text
    .split("\n")
    .map((l) => `  ${l}`)
    .join("\n");

// CI で使うために、問題が 1 つでもあれば 1 で終わる。未決事項（questions）は人の判断待ちで、正常な状態なので失敗にしない。
const runCheck = async (argv: ReadonlyArray<string>, io: CliIo): Promise<number> => {
  if (wantsHelp(argv)) {
    io.stdout(`${CHECK_USAGE}\n`);
    return 0;
  }
  let parsed;
  try {
    parsed = parseArgs({ args: [...argv], allowPositionals: true, options: { cwd: { type: "string" } } });
  } catch (e) {
    io.stderr(`${messageOf(e)}\n${CHECK_USAGE}\n`);
    return 2;
  }
  const paths = expandSpecPaths(parsed.positionals);
  if (paths.length === 0) {
    io.stderr(`spec ファイル（*.spec.ts）を指定してください\n${CHECK_USAGE}\n`);
    return 2;
  }
  let failed = false;
  const tsc = findTsc(parsed.values.cwd ?? process.cwd());
  if (tsc === null) {
    io.stderr("typescript が見つからないので、型チェックを飛ばしました（--cwd で typescript を入れたディレクトリを指定できます）\n");
  } else {
    const result = typecheck(tsc, paths.map((p) => resolve(p)));
    failed ||= !result.ok;
    io.stdout(result.ok ? "✓ 型チェック\n" : `✗ 型チェック\n${indent(result.output)}\n`);
  }
  const loaded = [];
  for (const path of paths) {
    try {
      loaded.push(await loadObject(path));
    } catch (e) {
      failed = true;
      io.stdout(`✗ ${specNameOf(path)}: 読み込めない: ${messageOf(e)}\n`);
    }
  }
  for (const { spec, graph } of resolveLinks(loaded)) {
    const labels = new Map(graph.states.map((s) => [s.id, s.label]));
    const labelOf = (id: string) => labels.get(id) ?? id;
    const { pending, onHold } = reviewItems(spec, graph);
    if (graph.findings.length + pending.length === 0) {
      io.stdout(`✓ ${spec.name}${onHold.length === 0 ? "" : `（判断待ち ${onHold.length} 件）`}\n`);
      continue;
    }
    failed = true;
    io.stdout(
      [
        `✗ ${spec.name}: 検査結果 ${graph.findings.length} 件、確かめてほしい点 ${pending.length} 件`,
        ...graph.findings.map((f) => `  - ${describeFinding(f, labelOf)}`),
        ...pending.map((i) => `  - ${i.message}（${i.id}）`),
      ].join("\n") + "\n",
    );
  }
  return failed ? 1 : 0;
};


const SKILLS_USAGE = "usage: live-spec skills install [--dir <path>]（既定は .claude/skills） [--force]";

const runSkills = (argv: ReadonlyArray<string>, io: CliIo): number => {
  if (wantsHelp(argv)) {
    io.stdout(`${SKILLS_USAGE}\n`);
    return 0;
  }
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: { dir: { type: "string" }, force: { type: "boolean" } },
    });
  } catch (e) {
    io.stderr(`${messageOf(e)}\n${SKILLS_USAGE}\n`);
    return 2;
  }
  if (parsed.positionals[0] !== "install") {
    io.stderr(`${SKILLS_USAGE}\n`);
    return 2;
  }
  const dir = parsed.values.dir ?? ".claude/skills";
  const label = { installed: "入れました", updated: "上書きしました", skipped: "すでにあるので飛ばしました（--force で上書き）" };
  for (const r of installSkills(dir, { force: parsed.values.force ?? false })) io.stdout(`${r.name}: ${label[r.status]}\n`);
  io.stdout(`${dir} に live-spec の skill を置きました。Claude Code を起動し直すと使えます。\n`);
  return 0;
};

export const runCli = async (argv: ReadonlyArray<string>, io: CliIo): Promise<number | null> => {
  if (argv[0] === "diff") return runDiff(argv.slice(1), io);
  if (argv[0] === "skills") return runSkills(argv.slice(1), io);
  if (argv[0] === "check") return runCheck(argv.slice(1), io);
  if (wantsHelp(argv)) {
    io.stdout(`${[USAGE, DIFF_USAGE, CHECK_USAGE, SKILLS_USAGE].join("\n")}\n`);
    return 0;
  }
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
  // CLI として起動したときだけ登録する。ライブラリとして読み込んだ側（テストランナーなど）の読み込み方には手を出さない。
  registerSpecLoader();
  const code = await runCli(process.argv.slice(2), {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
  });
  if (code !== null) process.exitCode = code;
}
