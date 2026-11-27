import { api, ensure } from "../src/index.ts";

/**
 * --serve で起動するローカルの HTTP サーバ。
 *
 * 生成した仕様書のページと、再読み込みの通知（SSE）だけを返す。それ以外のファイルは配信しない。
 */
export type Server = { status: "起動中" | "待ち受け中" | "起動に失敗" };

type Client =
  | { kind: "cli" }
  | { kind: "browser"; host: "127.0.0.1" | "localhost" | "evil.example.com" };

export const initial: Server = { status: "起動中" };

export const glossary = {
  "DNS リバインディング": "外部のサイトが自分のドメイン名を 127.0.0.1 に向け直し、ブラウザ経由でローカルのサーバの内容を読み取る攻撃",
  SSE: "Server-Sent Events。サーバからブラウザへ通知を送り続ける仕組み。再読み込みの通知に使う",
};

export const actors: Record<string, Client> = {
  CLI: { kind: "cli" },
  "127.0.0.1 で開いたブラウザ": { kind: "browser", host: "127.0.0.1" },
  "localhost で開いたブラウザ": { kind: "browser", host: "localhost" },
  "外部サイト経由のブラウザ（DNS リバインディング）": { kind: "browser", host: "evil.example.com" },
};

export const inputs = {
  listen: { 空いているポート: [true], 使用中のポート: [false] },
  request: {
    "GET /": ["/"],
    "GET /__live-spec/events": ["/__live-spec/events"],
    "GET /package.json": ["/package.json"],
  },
};

/** 127.0.0.1 で待ち受けを始める */
export function listen(s: Server, client: Client, portFree: boolean): Server {
  ensure(client.kind === "cli", "CLI だけ");
  ensure(s.status === "起動中", "起動中のときだけ");
  return { status: portFree ? "待ち受け中" : "起動に失敗" };
}

/**
 * ブラウザがリクエストを送る
 *
 * 状態は変わらない。応答は「見える画面」の欄に出る。
 */
export function request(s: Server, client: Client, path: string): Server {
  ensure(client.kind === "browser", "ブラウザだけ");
  ensure(s.status === "待ち受け中", "待ち受け中のときだけ");
  ensure(client.host !== "evil.example.com", "Host が 127.0.0.1 か localhost のときだけ（ほかは 403）");
  ensure(path === "/" || path === "/__live-spec/events", "仕様書のページと通知の接続だけ（ほかは 404）");
  return s;
}

export const scenarios = {
  ブラウザで仕様書を開く: [
    { do: listen, by: "CLI", input: "空いているポート", expect: { status: "待ち受け中" } },
    { do: request, by: "127.0.0.1 で開いたブラウザ", input: "GET /" },
  ],
  外部サイトからは読めない: [
    { do: listen, by: "CLI", input: "空いているポート" },
    { do: request, by: "外部サイト経由のブラウザ（DNS リバインディング）", input: "GET /", denied: "Host が 127.0.0.1 か localhost のときだけ（ほかは 403）" },
  ],
  仕様書と通知のほかは返さない: [
    { do: listen, by: "CLI", input: "空いているポート" },
    { do: request, by: "127.0.0.1 で開いたブラウザ", input: "GET /package.json", denied: "仕様書のページと通知の接続だけ（ほかは 404）" },
  ],
  起動に失敗したらつながらない: [
    { do: listen, by: "CLI", input: "使用中のポート", expect: { status: "起動に失敗" } },
    { do: request, by: "127.0.0.1 で開いたブラウザ", input: "GET /", denied: "待ち受け中のときだけ" },
  ],
};

export const reviewed = {
  "unguarded:listen:CLI だけ": "待ち受けを始めるのは live-spec のコマンド。出来事を起こす主体の区別で、要件としての制限ではない",
  "unguarded:listen:起動中のときだけ": "1 回の起動で待ち受けを始めるのは 1 回だけ（モデルの前提）",
  "unguarded:request:ブラウザだけ": "リクエストを送るのはブラウザ。live-spec のコマンドは自分のサーバにリクエストを送らない",
  "indistinguishable-example:request:GET /,GET /__live-spec/events": "どちらにも応える。違いは中身（仕様書の HTML か、通知のストリームか）で、状態として表す必要はない",
  "indistinguishable-actor:127.0.0.1 で開いたブラウザ,localhost で開いたブラウザ": "Host が 127.0.0.1 でも localhost でも同じように受け付けることを示すための 2 つの登場人物",
};

/** ブラウザが GET / を送ったときの応答 */
export function surface(s: Server, client: Client) {
  if (client.kind === "cli") return null;
  if (s.status !== "待ち受け中") return api.response(0, { error: "接続できない" });
  if (client.host === "evil.example.com") return api.response(403);
  return api.response(200, "仕様書の HTML（再読み込み用のスクリプトと版数を差し込んだもの）");
}
