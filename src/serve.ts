import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export const EVENTS_PATH = "/__live-spec/events";

export interface SpecServer {
  readonly url: string;
  update(html: string): void;
  close(): Promise<void>;
}

// 再読み込みのスクリプトを生成時ではなく配信時に差し込む理由: --out で書き出すファイルは
// サーバなしで開いても動く単体の HTML のままにしておきたいため。
// ページに版数を埋め込み、通知の接続がつながったときにサーバの版数と比べる理由:
// ページを読み込んでから接続がつながるまでの間に生成し直されると、その時点で接続がないので
// reload の通知を受け取れない。接続時に版数を確かめれば、その間の更新も取りこぼさない。
export const injectReload = (html: string, version: number): string =>
  html.replace(
    "</body>",
    `<script>(function () {
  var version = ${version};
  var es = new EventSource("${EVENTS_PATH}");
  es.onmessage = function (e) {
    if (e.data === "reload" || (e.data.indexOf("version ") === 0 && e.data !== "version " + version)) location.reload();
  };
  // 接続が切れたことを表示する理由: サーバを止めると、開いたままのタブは何も知らせずに古い仕様書を
  // 表示し続けていた（specs/browser-tab.spec.ts の未決事項だったもの）。つなぎ直せたら消す。
  var banner = null;
  es.onerror = function () {
    if (banner) return;
    banner = document.createElement("div");
    banner.textContent = "サーバとの接続が切れました。この仕様書は最新ではないかもしれません。";
    banner.setAttribute("style", "position:fixed;top:0;left:0;right:0;z-index:100;padding:8px 16px;background:#b3501a;color:#fff;font:14px system-ui,sans-serif;text-align:center");
    document.body.append(banner);
  };
  es.onopen = function () { if (banner) { banner.remove(); banner = null; } };
})();</script>\n</body>`,
  );

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);

export const startServer = (port: number): Promise<SpecServer> =>
  new Promise((resolve, reject) => {
    let html = "<!doctype html><html><body><p>仕様書を生成しています…</p></body></html>";
    let version = 0;
    const clients = new Set<ServerResponse>();

    const server = createServer((req, res) => {
      // Host ヘッダを確かめる理由: DNS リバインディングで外部のサイトが自分のドメイン名を
      // 127.0.0.1 に向け直すと、このサーバの内容をブラウザ経由で読み取れてしまうため。
      const host = (req.headers.host ?? "").replace(/:\d+$/, "");
      if (!LOCAL_HOSTS.has(host)) {
        res.writeHead(403).end();
        return;
      }
      if (req.url === "/") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        res.end(injectReload(html, version));
        return;
      }
      if (req.url === EVENTS_PATH) {
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
        res.write(`: connected\n\ndata: version ${version}\n\n`);
        clients.add(res);
        req.on("close", () => clients.delete(res));
        return;
      }
      res.writeHead(404).end();
    });

    server.on("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const { port: actual } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${actual}/`,
        update(next) {
          html = next;
          version += 1;
          for (const client of clients) client.write("data: reload\n\n");
        },
        close() {
          for (const client of clients) client.end();
          return new Promise((done) => server.close(() => done()));
        },
      });
    });
  });
