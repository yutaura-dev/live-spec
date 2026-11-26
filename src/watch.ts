import { watch, type FSWatcher } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { expandSpecPaths, failureOutput, generateProject, writeProjectOutput, type OutputFormat } from "./generate.ts";

export interface WatchOptions {
  readonly paths: ReadonlyArray<string>;
  readonly format: OutputFormat;
  readonly out: string | null;
  readonly title?: string | null;
  readonly tests?: ReadonlyArray<string>;
  readonly onBuilt?: (output: string) => void;
}

// 保存後に少し待ってから生成する理由: エディタは 1 回の保存で複数の変更イベントを出すことが多く、
// そのたびに生成すると書きかけの内容を読んだり、同じ生成を何度も走らせたりするため。
const DEBOUNCE_MS = 80;

export const watchSpec = (options: WatchOptions, log: (message: string) => void = console.error): ReadonlyArray<FSWatcher> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let queue = Promise.resolve();

  const rebuild = () => {
    queue = queue.then(async () => {
      const started = performance.now();
      // 生成のたびにディレクトリを展開し直す理由: 監視中に spec ファイルが増えても、次の保存で拾えるようにするため。
      const paths = expandSpecPaths(options.paths);
      try {
        const output = await generateProject(paths, options.format, options.title ?? undefined, options.tests);
        if (options.out !== null) await writeProjectOutput(options.out, output);
        if (output.kind === "text") options.onBuilt?.(output.content);
        const ms = Math.round(performance.now() - started);
        log(options.out === null ? `✓ 生成しました（${ms}ms）` : `✓ ${options.out} を生成しました（${ms}ms）`);
      } catch (e) {
        log(`✗ 生成に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
        // 失敗しても監視は続ける。書きかけの spec が一時的に壊れているのはよくあることなので。
        const failure = failureOutput(options.format, paths, e);
        if (options.out !== null) await writeProjectOutput(options.out, failure);
        if (failure.kind === "text") options.onBuilt?.(failure.content);
      }
    });
  };

  // ファイルではなくディレクトリを監視する理由: 多くのエディタは「別ファイルに書いてから名前を差し替える」
  // 方式で保存するので、ファイル自体を監視すると最初の保存で追跡が切れる。
  const dirs = [...new Set(expandSpecPaths(options.paths).map((p) => dirname(resolve(p))).concat(
    options.paths.filter((p) => !p.endsWith(".ts")).map((p) => resolve(p)),
  ))];
  const watchers = dirs.map((dir) =>
    watch(dir, { recursive: true }, (_event, filename) => {
      if (filename === null || !basename(filename).endsWith(".spec.ts")) return;
      clearTimeout(timer);
      timer = setTimeout(rebuild, DEBOUNCE_MS);
    }),
  );
  log(`${options.paths.join(", ")} を監視しています（Ctrl+C で終了）`);
  rebuild();
  return watchers;
};
