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
export const injectReload = (html: string): string =>
  html.replace(
    "</body>",
    `<script>new EventSource("${EVENTS_PATH}").onmessage = function () { location.reload(); };</script>\n</body>`,
  );

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);

export const startServer = (port: number): Promise<SpecServer> =>
  new Promise((resolve, reject) => {
    let html = "<!doctype html><html><body><p>仕様書を生成しています…</p></body></html>";
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
        res.end(injectReload(html));
        return;
      }
      if (req.url === EVENTS_PATH) {
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
        res.write(": connected\n\n");
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
          for (const client of clients) client.write("data: reload\n\n");
        },
        close() {
          for (const client of clients) client.end();
          return new Promise((done) => server.close(() => done()));
        },
      });
    });
  });
