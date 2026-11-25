import { request } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { EVENTS_PATH, injectReload, startServer, type SpecServer } from "../src/serve.ts";

let server: SpecServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

const get = (url: string, headers: Record<string, string> = {}) =>
  new Promise<{ status: number; type: string; body: string }>((resolve, reject) => {
    const req = request(url, { headers }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        body += chunk;
        if (res.headers["content-type"]?.startsWith("text/event-stream") && body.includes("\n\n")) {
          resolve({ status: res.statusCode!, type: res.headers["content-type"], body });
          req.destroy();
        }
      });
      res.on("end", () => resolve({ status: res.statusCode!, type: res.headers["content-type"] ?? "", body }));
    });
    req.on("error", reject);
    req.end();
  });

describe("startServer: 仕様書をブラウザに配信するローカルサーバ", () => {
  it("127.0.0.1 だけで待ち受ける", async () => {
    server = await startServer(0);

    expect(new URL(server.url).hostname).toBe("127.0.0.1");
  });

  it("/ で最新の仕様書を、再読み込み用のスクリプトを差し込んで返す", async () => {
    server = await startServer(0);
    server.update("<!doctype html><html><body><h1>v1</h1></body></html>");

    const res = await get(server.url);

    expect(res.status).toBe(200);
    expect(res.body).toContain("<h1>v1</h1>");
    expect(res.body).toContain(EVENTS_PATH);
  });

  it("更新されたら、接続中のページに再読み込みを通知する", async () => {
    server = await startServer(0);
    const events: Array<string> = [];
    await new Promise<void>((resolve) => {
      const req = request(new URL(EVENTS_PATH, server!.url), (res) => {
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          events.push(chunk);
          if (chunk.includes("connected")) server!.update("<html><body>v2</body></html>");
          if (chunk.includes("reload")) {
            req.destroy();
            resolve();
          }
        });
      });
      req.end();
    });

    expect(events.join("")).toContain("data: reload");
  });

  it("生成したページとイベント以外のパスは 404 を返す（ファイルを配信しない）", async () => {
    server = await startServer(0);

    expect((await get(new URL("/../package.json", server.url).href)).status).toBe(404);
  });

  it("Host ヘッダが localhost でなければ拒否する（DNS リバインディング対策）", async () => {
    server = await startServer(0);

    expect((await get(server.url, { host: "evil.example.com" })).status).toBe(403);
  });
});

describe("startServer: 読み込みから通知の接続までの間の更新を取りこぼさない", () => {
  const firstEvent = (url: string) =>
    new Promise<string>((resolve) => {
      const req = request(url, (res) => {
        let buf = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          buf += chunk;
          const m = /data: ([^\n]*)\n\n/.exec(buf);
          if (m) {
            req.destroy();
            resolve(m[1]!);
          }
        });
      });
      req.end();
    });

  it("配信するページに、その内容の版数を埋め込む", async () => {
    server = await startServer(0);
    server.update("<html><body>v1</body></html>");

    expect((await get(server.url)).body).toContain("var version = 1;");
  });

  it("通知の接続がつながったら、今の版数を送る", async () => {
    server = await startServer(0);
    server.update("<html><body>v1</body></html>");
    await get(server.url);
    server.update("<html><body>v2</body></html>");

    expect(await firstEvent(new URL(EVENTS_PATH, server.url).href)).toBe("version 2");
  });
});

describe("injectReload: 再読み込み用のスクリプトを差し込む", () => {
  it("</body> の直前に差し込む", () => {
    expect(injectReload("<html><body>x</body></html>", 3)).toMatch(/x<script>[\s\S]*<\/script>\n<\/body>/);
  });

  it("サーバとの接続が切れたら、ページの上部にそのことを表示する", () => {
    const script = injectReload("<html><body>x</body></html>", 3);

    expect(script).toContain("onerror");
    expect(script).toContain("サーバとの接続が切れました");
  });

  it("受け取った版数がページの版数と違えば再読み込みする", () => {
    const script = injectReload("<html><body>x</body></html>", 3);

    expect(script).toContain("var version = 3;");
    expect(script).toContain('"version " + version');
  });
});
