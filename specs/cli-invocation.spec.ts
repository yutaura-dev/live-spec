import { cli, ensure } from "../src/index.ts";

/**
 * live-spec のコマンド（pnpm spec / live-spec）を 1 回起動したときの流れ。
 *
 * どの引数の組み合わせが通り、どの状態で動き続けるか（監視・配信）または終わるかを表す。
 */
export type Invocation = {
  status: "起動前" | "書き出して終了" | "監視中" | "配信中" | "生成に失敗して終了" | "ポートが使えず終了" | "Ctrl+C で終了";
};

type User = { kind: "user" };

/** 引数の組み合わせ。環境（spec が壊れている、ポートが使用中）も入力として表す。 */
type Args = {
  paths: number;
  html?: boolean;
  json?: boolean;
  out?: boolean;
  watch?: boolean;
  serve?: boolean;
  port?: "ok" | "empty" | "invalid";
  brokenSpec?: boolean;
  portInUse?: boolean;
};

export const initial: Invocation = { status: "起動前" };

export const actors: Record<string, User> = { 利用者: { kind: "user" } };

export const inputs = {
  start: {
    "spec を 1 つ": [{ paths: 1 }],
    "ディレクトリ（spec が複数）": [{ paths: 2 }],
    "ディレクトリ（spec が複数）--out dir": [{ paths: 2, out: true }],
    "--html --out file": [{ paths: 1, html: true, out: true }],
    "--json": [{ paths: 1, json: true }],
    "--html --json": [{ paths: 1, html: true, json: true }],
    "--watch --out file": [{ paths: 1, watch: true, out: true }],
    "--watch（--out なし）": [{ paths: 1, watch: true }],
    "--serve": [{ paths: 1, serve: true }],
    "--serve --json": [{ paths: 1, serve: true, json: true }],
    "--port 5000（--serve なし）": [{ paths: 1, port: "ok" }],
    "--serve --port \"\"": [{ paths: 1, serve: true, port: "empty" }],
    "パスなし": [{ paths: 0 }],
    "壊れた spec": [{ paths: 1, brokenSpec: true }],
    "--serve（ポートが使用中）": [{ paths: 1, serve: true, portInUse: true }],
  } satisfies Record<string, [Args]>,
};

/**
 * 引数を渡して起動する
 *
 * 引数の誤りは終了コード 2 で、理由と usage を出して終わる（ここでは「できない入力」として表れる）。
 */
export function start(inv: Invocation, _user: User, args: Args): Invocation {
  ensure(inv.status === "起動前", "起動前のときだけ");
  // 根拠: src/cli.ts parseCliArgs（spec のパスが必須）
  ensure(args.paths > 0, "spec ファイルかディレクトリのパスが必要");
  // 根拠: src/cli.ts parseCliArgs（組み合わせのエラー）
  ensure(!(args.html && args.json), "--html と --json は同時に指定できない");
  ensure(!(args.serve && args.json), "--serve と --json は同時に指定できない");
  ensure(!(args.port !== undefined && !args.serve), "--port は --serve と一緒に指定する");
  ensure(args.port !== "empty" && args.port !== "invalid", "--port は 0〜65535 の整数");
  ensure(!(args.watch && !args.serve && !args.out), "--watch には --out が必要");
  // 根拠: src/cli.ts runCli（複数の Markdown は --out のディレクトリに書く）
  // 標準出力に連結して出す選択肢は設けない（決定済み。ほかのツールにつなぐ必要が出てから考える）。
  ensure(!(args.paths > 1 && !args.html && !args.json && !args.out && !args.watch && !args.serve), "spec が複数の Markdown には --out <ディレクトリ> が必要");
  // 根拠: src/cli.ts runCli（startServer の EADDRINUSE を捕まえて終了コード 1）
  if (args.serve) return { status: args.portInUse ? "ポートが使えず終了" : "配信中" };
  if (args.watch) return { status: "監視中" };
  // 根拠: src/cli.ts runCli（generateProject の失敗は短いメッセージで終了コード 1）
  return { status: args.brokenSpec ? "生成に失敗して終了" : "書き出して終了" };
}

export const links = [
  { from: start, to: "local-server", action: "listen", label: "--serve のときはローカルサーバを起動する" },
  { from: start, to: "watch-session", action: "save", label: "--watch / --serve のときは監視を始め、最初の生成をする" },
];

export const scenarios = {
  "HTML の仕様書を書き出す": [{ do: start, by: "利用者", input: "--html --out file", expect: { status: "書き出して終了" } }],
  ブラウザで見ながら書いて終える: [
    { do: start, by: "利用者", input: "--serve" },
    { do: interrupt, by: "利用者", expect: { status: "Ctrl+C で終了" } },
  ],
};

/**
 * Ctrl+C で止める
 *
 * 監視中・配信中は自分では終わらないので、利用者が止める。
 */
export function interrupt(inv: Invocation, _user: User): Invocation {
  ensure(inv.status === "監視中" || inv.status === "配信中", "監視中か配信中のときだけ");
  return { status: "Ctrl+C で終了" };
}

/** 利用者がターミナルで見るもの */
export function surface(inv: Invocation) {
  switch (inv.status) {
    case "起動前":
      return cli.output("$ pnpm spec <file.spec.ts | dir>... [--html | --json] [--out <file | dir>] [--watch] [--serve [--port <n>]]");
    case "書き出して終了":
      return cli.output("（標準出力か --out に仕様書を書いて、終了コード 0）");
    case "監視中":
      return cli.output("specs/ を監視しています（Ctrl+C で終了）\n✓ out/spec.html を生成しました（268ms）");
    case "配信中":
      return cli.output("http://127.0.0.1:4747/ で仕様書を配信しています。spec を保存するとブラウザが自動で再読み込みします");
    case "生成に失敗して終了":
      return cli.output("生成に失敗しました: Expression expected\n（終了コード 1）");
    case "ポートが使えず終了":
      return cli.output("ポート 4747 は使用中です。--port で別の番号を指定してください（0 なら空いている番号を使います）\n（終了コード 1）");
    case "Ctrl+C で終了":
      return cli.output("^C");
  }
}
