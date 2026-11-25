import { api, ensure } from "../src/index.ts";

/**
 * --serve で起動するローカルの HTTP サーバ。
 *
 * 生成した仕様書のページと、再読み込みの通知（SSE）だけを返す。ファイルは配信しない。
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
  // 根拠: src/serve.ts startServer（server.listen(port, "127.0.0.1")）
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
  // 根拠: src/serve.ts（Host ヘッダが 127.0.0.1 / localhost でなければ 403。DNS リバインディング対策）
  ensure(client.host !== "evil.example.com", "Host が 127.0.0.1 か localhost のときだけ（ほかは 403）");
  // 根拠: src/serve.ts（/ と /__live-spec/events 以外は 404）
  ensure(path === "/" || path === "/__live-spec/events", "仕様書のページと通知の接続だけ（ほかは 404）");
  return s;
}

/** ブラウザが GET / を送ったときの応答 */
export function surface(s: Server, client: Client) {
  if (client.kind === "cli") return null;
  if (s.status !== "待ち受け中") return api.response(0, { error: "接続できない" });
  if (client.host === "evil.example.com") return api.response(403);
  return api.response(200, "仕様書の HTML（再読み込み用のスクリプトと版数を差し込んだもの）");
}
