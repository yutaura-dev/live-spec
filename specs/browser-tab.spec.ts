import { ensure, ui } from "../src/index.ts";

/**
 * --serve の仕様書を開いているブラウザのタブ。
 *
 * spec が生成し直されると、サーバからの通知でページを再読み込みし、最新の仕様書を表示する。
 * ページを読み込んでから通知の接続がつながるまでに生成し直されても、接続したときに版数を比べて再読み込みする。
 */
export type Tab = {
  status: "閉じている" | "最新を表示" | "再読み込み中" | "接続が切れた";
};

type Who = { kind: "person" } | { kind: "browser" } | { kind: "server" };

export const initial: Tab = { status: "閉じている" };

// 再読み込みは利用者の操作ではなくブラウザが自動で行うので、ブラウザを別の登場人物にする。
export const actors: Record<string, Who> = {
  利用者: { kind: "person" },
  "ブラウザ（自動）": { kind: "browser" },
  サーバ: { kind: "server" },
};

export const scenarios = {
  開いて保存を待つ: [
    { do: open, by: "利用者" },
    { do: notify, by: "サーバ" },
    { do: reloaded, by: "ブラウザ（自動）", expect: { status: "最新を表示" } },
  ],
  接続が切れたタブは通知では再読み込みしない: [
    { do: open, by: "利用者" },
    { do: serverStopped, by: "サーバ", expect: { status: "接続が切れた" } },
    { do: notify, by: "サーバ", denied: "最新を表示しているときだけ" },
    { do: serverRestarted, by: "サーバ", expect: { status: "最新を表示" } },
  ],
};

export const reviewed = {
  "unguarded:open:利用者だけ": "タブを開くのは利用者。出来事を起こす主体の区別で、要件としての制限ではない",
  "unguarded:close:利用者だけ": "タブを閉じるのは利用者。出来事を起こす主体の区別で、要件としての制限ではない",
  "unguarded:reloaded:再読み込み中のときだけ": "再読み込みが終わるのは、再読み込みを始めたあとだけ（出来事の順序）",
  "unguarded:serverStopped:開いているときだけ": "閉じたタブはサーバとつながっていないので、サーバが止まっても何も起きない",
  "unguarded:serverRestarted:接続が切れているときだけ": "つながったままのタブは通知で最新になる。再起動を検知して読み直すのは、接続が切れたタブだけ",
};

/** URL を開く */
export function open(tab: Tab, who: Who): Tab {
  ensure(who.kind === "person", "利用者だけ");
  ensure(tab.status === "閉じている", "閉じているときだけ");
  return { status: "最新を表示" };
}

/**
 * 生成し直したことを通知する
 *
 * 通知の接続がつながったとき、その時点の版数も送る（src/serve.ts）。ページの版数と違えば再読み込みする。
 */
export function notify(tab: Tab, who: Who): Tab {
  ensure(who.kind === "server", "サーバだけ");
  ensure(tab.status === "最新を表示", "最新を表示しているときだけ");
  return { status: "再読み込み中" };
}

/**
 * 再読み込みが終わる
 *
 * 選んでいた状態は URL の hash から復元される。
 */
export function reloaded(tab: Tab, who: Who): Tab {
  ensure(who.kind === "browser", "ブラウザが自動で行う");
  ensure(tab.status === "再読み込み中", "再読み込み中のときだけ");
  return { status: "最新を表示" };
}

/**
 * サーバが止まる
 *
 * 通知の接続が切れたことをページの上部に表示する（src/serve.ts injectReload の onerror）。
 */
export function serverStopped(tab: Tab, who: Who): Tab {
  ensure(who.kind === "server", "サーバだけ");
  ensure(tab.status === "最新を表示" || tab.status === "再読み込み中", "開いているときだけ");
  return { status: "接続が切れた" };
}

/**
 * サーバが再び起動する
 *
 * EventSource がつなぎ直し、表示を消す。版数が変わっていれば再読み込みする。
 */
export function serverRestarted(tab: Tab, who: Who): Tab {
  ensure(who.kind === "server", "サーバだけ");
  ensure(tab.status === "接続が切れた", "接続が切れているときだけ");
  return { status: "最新を表示" };
}

/** タブを閉じる */
export function close(tab: Tab, who: Who): Tab {
  ensure(who.kind === "person", "利用者だけ");
  ensure(tab.status !== "閉じている", "開いているときだけ");
  return { status: "閉じている" };
}

export function surface(tab: Tab, who: Who) {
  if (who.kind !== "person") return null;
  return ui.screen(
    "仕様書のタブ",
    ui.badge(tab.status),
    tab.status === "閉じている" && ui.button("http://127.0.0.1:4747/ を開く", open),
    tab.status === "再読み込み中" && ui.text("再読み込みしています…"),
    tab.status === "接続が切れた" && ui.text("サーバとの接続が切れました。この仕様書は最新ではないかもしれません。"),
    tab.status !== "閉じている" && ui.button("タブを閉じる", close),
  );
}
