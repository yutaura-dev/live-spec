import { cli } from "live-spec";

/**
 * --watch / --serve で spec を監視しているあいだの、書き出した仕様書の中身。
 *
 * spec を保存するたびに生成し直す。失敗しても監視は止まらない。
 */
export type Session = { output: "未生成" | "最新" | "エラーページ" | "前回のまま" };

type Watcher = { format: "html" | "markdown" };

export const initial: Session = { output: "未生成" };

// 形式で失敗時の振る舞いが変わるので、形式ごとに監視している人を分ける。
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

export const questions = [
  {
    ask: "Markdown / JSON の監視で生成に失敗したとき、古い内容のままにしてよいか？",
    about: { output: "前回のまま" },
    note: "HTML はエラーページになるが、Markdown / JSON は前回の内容が残るので、読み手が古い仕様を最新だと取り違えうる（src/watch.ts）",
  },
];

/**
 * spec を保存する
 *
 * 起動直後の 1 回目の生成も同じ扱い。保存から 80ms 待ってから生成する（src/watch.ts DEBOUNCE_MS）。
 */
export function save(_s: Session, watcher: Watcher, valid: boolean): Session {
  if (valid) return { output: "最新" };
  // 根拠: src/watch.ts rebuild（HTML のときだけエラーページを書き出す）
  return { output: watcher.format === "html" ? "エラーページ" : "前回のまま" };
}

export function surface(s: Session, watcher: Watcher) {
  const file = watcher.format === "html" ? "out/spec.html" : "out/spec/";
  switch (s.output) {
    case "未生成":
      return cli.output("specs/ を監視しています（Ctrl+C で終了）");
    case "最新":
      return cli.output(`✓ ${file} を生成しました（268ms）`);
    case "エラーページ":
      return cli.output(`✗ 生成に失敗しました: Expression expected\n（${file} はエラーページになる）`);
    case "前回のまま":
      return cli.output(`✗ 生成に失敗しました: Expression expected\n（${file} は前回の内容のまま）`);
  }
}
