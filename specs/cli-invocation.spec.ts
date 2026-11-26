import { cli, ensure } from "../src/index.ts";

/**
 * live-spec のコマンド（pnpm spec / live-spec / live-spec diff / live-spec skills install）を 1 回起動したときの流れ。
 *
 * どの引数の組み合わせが通り、どの状態で動き続けるか（監視・配信）または終わるかを表す。
 */
export type Invocation = {
  status:
    | "起動前"
    | "書き出して終了"
    | "監視中"
    | "配信中"
    | "生成に失敗して終了"
    | "ポートが使えず終了"
    | "差分を取れずに終了"
    | "skill を置いて終了"
    | "使い方を出して終了"
    | "Ctrl+C で終了";
};

type User = { kind: "user" };

/** 引数の組み合わせ。環境（spec が壊れている、ポートが使用中）も入力として表す。 */
type Args = {
  paths: number;
  help?: boolean;
  html?: boolean;
  json?: boolean;
  out?: boolean;
  watch?: boolean;
  serve?: boolean;
  port?: "ok" | "empty" | "invalid";
  brokenSpec?: boolean;
  portInUse?: boolean;
};

/** live-spec diff の引数。環境（リビジョンがない）も入力として表す。 */
type DiffArgs = { paths: number; html?: boolean; json?: boolean; unknownRevision?: boolean };

type SkillsArgs = { sub: "install" | "other" };

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
    "--help": [{ paths: 0, help: true }],
    "壊れた spec": [{ paths: 1, brokenSpec: true }],
    "--serve（ポートが使用中）": [{ paths: 1, serve: true, portInUse: true }],
  } satisfies Record<string, [Args]>,
  diff: {
    "specs/ --base main --head feature": [{ paths: 1 }],
    "--html --json": [{ paths: 1, html: true, json: true }],
    パスなし: [{ paths: 0 }],
    存在しないリビジョン: [{ paths: 1, unknownRevision: true }],
  } satisfies Record<string, [DiffArgs]>,
  installSkills: {
    install: [{ sub: "install" }],
    "install 以外": [{ sub: "other" }],
  } satisfies Record<string, [SkillsArgs]>,
};

/**
 * 引数を渡して起動する
 *
 * 引数の誤りは終了コード 2 で、理由と usage を出して終わる（ここでは「できない入力」として表れる）。
 */
export function start(inv: Invocation, _user: User, args: Args): Invocation {
  ensure(inv.status === "起動前", "起動前のときだけ");
  // 根拠: src/cli.ts runCli（--help / -h はほかの引数より先に見て、使い方を出して終了コード 0）
  if (args.help) return { status: "使い方を出して終了" };
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

/**
 * 仕様の差分を出す（live-spec diff）
 *
 * --base（既定は HEAD）と --head（省くと作業ツリー）の spec を、ドメインオブジェクトごとに比べて、Markdown か HTML で出す。
 */
export function diff(inv: Invocation, _user: User, args: DiffArgs): Invocation {
  ensure(inv.status === "起動前", "起動前のときだけ");
  // 根拠: src/cli.ts runDiff（パスがない・組み合わせの誤りは usage を出して終了コード 2）
  ensure(args.paths > 0, "比べる spec ファイルかディレクトリが必要");
  ensure(!(args.html && args.json), "--html と --json は同時に指定できない");
  // 根拠: src/project-diff.ts diffProject（リビジョンを確かめて、なければ終了コード 1）
  return { status: args.unknownRevision ? "差分を取れずに終了" : "書き出して終了" };
}

/** 同梱の skill をプロジェクトの .claude/skills に置く（live-spec skills install） */
export function installSkills(inv: Invocation, _user: User, args: SkillsArgs): Invocation {
  ensure(inv.status === "起動前", "起動前のときだけ");
  // 根拠: src/cli.ts runSkills（install 以外は usage を出して終了コード 2）
  ensure(args.sub === "install", "サブコマンドは install だけ");
  // 根拠: src/skills.ts installSkills（すでにある skill は --force がなければ上書きしない）
  return { status: "skill を置いて終了" };
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
  引数の誤りは使い方を出して断る: [
    { do: start, by: "利用者", input: "パスなし", denied: "spec ファイルかディレクトリのパスが必要" },
    { do: start, by: "利用者", input: "--html --json", denied: "--html と --json は同時に指定できない" },
    { do: start, by: "利用者", input: "--serve --json", denied: "--serve と --json は同時に指定できない" },
    { do: start, by: "利用者", input: "--port 5000（--serve なし）", denied: "--port は --serve と一緒に指定する" },
    { do: start, by: "利用者", input: '--serve --port ""', denied: "--port は 0〜65535 の整数" },
    { do: start, by: "利用者", input: "--watch（--out なし）", denied: "--watch には --out が必要" },
    { do: start, by: "利用者", input: "ディレクトリ（spec が複数）", denied: "spec が複数の Markdown には --out <ディレクトリ> が必要" },
    { do: diff, by: "利用者", input: "パスなし", denied: "比べる spec ファイルかディレクトリが必要" },
    { do: diff, by: "利用者", input: "--html --json", denied: "--html と --json は同時に指定できない" },
    { do: installSkills, by: "利用者", input: "install 以外", denied: "サブコマンドは install だけ" },
  ],
  使い方を見る: [{ do: start, by: "利用者", input: "--help", expect: { status: "使い方を出して終了" } }],
  ブランチ間の仕様の差分を見る: [{ do: diff, by: "利用者", input: "specs/ --base main --head feature", expect: { status: "書き出して終了" } }],
  存在しないリビジョンとは比べられない: [{ do: diff, by: "利用者", input: "存在しないリビジョン", expect: { status: "差分を取れずに終了" } }],
  "skill を入れる": [{ do: installSkills, by: "利用者", input: "install", expect: { status: "skill を置いて終了" } }],
};

export const reviewed = {
  "unguarded:start:起動前のときだけ": "1 回の起動を表す spec なので、起動し直すことはない（モデルの前提）",
  "unguarded:diff:起動前のときだけ": "1 回の起動を表す spec なので、起動し直すことはない（モデルの前提）",
  "unguarded:installSkills:起動前のときだけ": "1 回の起動を表す spec なので、起動し直すことはない（モデルの前提）",
  "unguarded:interrupt:監視中か配信中のときだけ": "書き出して終わるコマンドは自分で終わる。Ctrl+C で止めるのは、動き続ける監視中と配信中だけ",
  "indistinguishable-example:start:spec を 1 つ,ディレクトリ（spec が複数）--out dir,--html --out file,--json":
    "どれも書き出して終わる。出力の形式と出力先の違いは、状態として表さない（出力の中身は表さない方針）",
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
      return cli.output(
        "$ live-spec <file.spec.ts | dir>... [--html | --json] [--out <file | dir>] [--watch] [--serve [--port <n>]]\n$ live-spec diff <file.spec.ts | dir>... [--base <rev>] [--head <rev>] [--html | --json] [--out <file>]\n$ live-spec skills install [--dir <path>] [--force]",
      );
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
    case "差分を取れずに終了":
      return cli.output("差分を取れませんでした: リビジョン nope が見つかりません\n（終了コード 1）");
    case "skill を置いて終了":
      return cli.output(".claude/skills に live-spec の skill を置きました。Claude Code を起動し直すと使えます。");
    case "使い方を出して終了":
      return cli.output("usage: live-spec <file.spec.ts | dir>... [--html | --json] ...\nusage: live-spec diff ...\nusage: live-spec skills install ...");
    case "Ctrl+C で終了":
      return cli.output("^C");
  }
}
