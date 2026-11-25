import { watch, type FSWatcher } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { generate, specNameOf, writeOutput, type OutputFormat } from "./generate.ts";
import { renderErrorHtml } from "./render/html.ts";

export interface WatchOptions {
  readonly path: string;
  readonly out: string;
  readonly format: OutputFormat;
}

// 保存後に少し待ってから生成する理由: エディタは 1 回の保存で複数の変更イベントを出すことが多く、
// そのたびに生成すると書きかけの内容を読んだり、同じ生成を何度も走らせたりするため。
const DEBOUNCE_MS = 80;

export const watchSpec = (options: WatchOptions, log: (message: string) => void = console.error): FSWatcher => {
  const path = resolve(options.path);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let queue = Promise.resolve();

  const rebuild = () => {
    queue = queue.then(async () => {
      const started = performance.now();
      try {
        await writeOutput(options.out, await generate(path, options.format));
        log(`✓ ${options.out} を生成しました（${Math.round(performance.now() - started)}ms）`);
      } catch (e) {
        log(`✗ 生成に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
        // 失敗しても監視は続ける。書きかけの spec が一時的に壊れているのはよくあることなので。
        if (options.format === "html") await writeOutput(options.out, renderErrorHtml(specNameOf(path), e));
      }
    });
  };

  // ファイルではなくディレクトリを監視する理由: 多くのエディタは「別ファイルに書いてから名前を差し替える」
  // 方式で保存するので、ファイル自体を監視すると最初の保存で追跡が切れる。
  const watcher = watch(dirname(path), (_event, filename) => {
    if (filename !== basename(path)) return;
    clearTimeout(timer);
    timer = setTimeout(rebuild, DEBOUNCE_MS);
  });
  log(`${options.path} を監視しています（Ctrl+C で終了）`);
  rebuild();
  return watcher;
};
