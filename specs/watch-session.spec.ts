import { cli } from "../src/index.ts";

/**
 * --watch / --serve で spec を監視しているあいだの、書き出した仕様書の中身。
 *
 * spec を保存するたびに生成し直す。失敗しても監視は止まらない。
 */
export type Session = { output: "未生成" | "最新" | "エラーページ" | "失敗のお知らせ" };

type Watcher = { format: "html" | "markdown" };

export const initial: Session = { output: "未生成" };

// 出力の形式によって失敗時の振る舞いが変わるので、形式ごとに監視している人を分ける。
export const actors: Record<string, Watcher> = {
  "HTML で監視": { format: "html" },
  "Markdown で監視": { format: "markdown" },
};

export const inputs = {
  save: { 正しい内容: [true], 壊れた内容: [false] },
};

export const links = [
  { from: save, to: "browser-tab", action: "notify", label: "--serve のときは、生成し直したことを開いているタブに通知する" },
];

/**
 * spec を保存する
 *
 * 起動直後の 1 回目の生成も同じ扱い。保存から 80ms 待ってから生成する（src/watch.ts DEBOUNCE_MS）。
 */
export function save(_s: Session, watcher: Watcher, valid: boolean): Session {
  if (valid) return { output: "最新" };
  // 前回の内容のまま残すと、古い仕様を最新だと取り違えるため、どの形式でも失敗したことを書き出す。
  return { output: watcher.format === "html" ? "エラーページ" : "失敗のお知らせ" };
}

export const reviewed = {
  "anytime:save": "監視中は、spec をいつ保存しても生成し直す。保存を断る状態はない",
  "unused-field:output": "output は書き出した仕様書の中身を表す。中身がどうであっても保存できるので、可否には使わない",
};

export function surface(s: Session, watcher: Watcher) {
  const file = watcher.format === "html" ? "out/spec.html" : "out/spec/";
  switch (s.output) {
    case "未生成":
      return cli.output("specs/ を監視しています（Ctrl+C で終了）");
    case "最新":
      return cli.output(`✓ ${file} を生成しました（268ms）`);
    case "エラーページ":
      return cli.output(`✗ 生成に失敗しました: Expression expected\n（${file} はエラーページになる）`);
    case "失敗のお知らせ":
      return cli.output(`✗ 生成に失敗しました: Expression expected\n（${file} には「仕様書を生成できませんでした」と書き出す）`);
  }
}
