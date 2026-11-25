import { mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pathToFileURL } from "node:url";
import { createServer } from "node:net";
import { mkdirSync, readFileSync } from "node:fs";
import { expandSpecPaths, generate, generateProject, isMain, outputFormatOf, parseCliArgs, runCli, specNameOf } from "../src/cli.ts";
import { failureOutput } from "../src/generate.ts";
import { renderErrorHtml } from "../src/render/html.ts";

describe("outputFormatOf: 出力形式をフラグから決める", () => {
  it("フラグがなければ Markdown にする", () => {
    expect(outputFormatOf([])).toBe("markdown");
  });

  it("--html なら HTML、--json なら JSON にする", () => {
    expect(outputFormatOf(["--html"])).toBe("html");
    expect(outputFormatOf(["--json"])).toBe("json");
  });
});

describe("specNameOf: ファイル名から spec 名を決める", () => {
  it(".spec.ts を除いたファイル名を spec 名にする", () => {
    expect(specNameOf("examples/article.spec.ts")).toBe("article");
  });

  it(".spec を含まない .ts でも拡張子を除く", () => {
    expect(specNameOf("/abs/path/order.ts")).toBe("order");
  });
});

describe("parseCliArgs: コマンドライン引数を解釈する", () => {
  it("spec のパス、出力形式、出力先、監視の有無を読む", () => {
    expect(parseCliArgs(["a.spec.ts", "--html", "--out", "out/a.html", "--watch"])).toEqual({
      paths: ["a.spec.ts"],
      format: "html",
      out: "out/a.html",
      watch: true,
      serve: false,
      port: 4747,
      title: null,
    });
  });

  it("出力先がなければ標準出力に書く（out は null）", () => {
    expect(parseCliArgs(["a.spec.ts"])).toEqual({
      paths: ["a.spec.ts"],
      format: "markdown",
      out: null,
      watch: false,
      serve: false,
      port: 4747,
      title: null,
    });
  });

  it("--serve は HTML を監視しながら配信する（--out は不要）", () => {
    expect(parseCliArgs(["a.spec.ts", "--serve", "--port", "5000"])).toEqual({
      paths: ["a.spec.ts"],
      format: "html",
      out: null,
      watch: true,
      serve: true,
      port: 5000,
      title: null,
    });
  });

  it("--watch には --out が必要", () => {
    expect(() => parseCliArgs(["a.spec.ts", "--watch"])).toThrow("--watch には --out");
  });

  it("--html と --json を同時に指定したらエラーにする（片方が黙って無視されないように）", () => {
    expect(() => parseCliArgs(["a.spec.ts", "--html", "--json"])).toThrow("--html と --json");
  });

  it("--serve と --json を同時に指定したらエラーにする（--serve は HTML だけを配信する）", () => {
    expect(() => parseCliArgs(["a.spec.ts", "--serve", "--json"])).toThrow("--serve と --json");
  });

  it("--serve なしの --port はエラーにする", () => {
    expect(() => parseCliArgs(["a.spec.ts", "--port", "5000"])).toThrow("--port は --serve");
  });

  it("--port に空文字を渡したらエラーにする", () => {
    expect(() => parseCliArgs(["a.spec.ts", "--serve", "--port", ""])).toThrow("--port には");
  });

  it("spec のパスを複数並べられる", () => {
    expect(parseCliArgs(["a.spec.ts", "b.spec.ts", "--html"]).paths).toEqual(["a.spec.ts", "b.spec.ts"]);
  });

  it("spec のパスがなければエラーにする", () => {
    expect(() => parseCliArgs(["--html"])).toThrow("spec ファイル");
  });
});

describe("generate: spec ファイルから仕様書を生成する", () => {
  const specSource = (status: string) =>
    `export const initial = { status: "${status}" };\nexport const actors = { someone: {} };\nexport function noop(s) { return s; }\n`;

  it("spec ファイルを書き換えたあとは、新しい内容で生成する", async () => {
    const dir = mkdtempSync(join(tmpdir(), "live-spec-"));
    const path = join(dir, "doc.spec.ts");
    writeFileSync(path, specSource("before"));
    const first = await generate(path, "json");

    writeFileSync(path, specSource("after"));
    const second = await generate(path, "json");

    expect(first).toContain('"before"');
    expect(second).toContain('"after"');
  });
});

describe("expandSpecPaths: ディレクトリを spec ファイルの一覧に展開する", () => {
  it("ディレクトリの中の *.spec.ts を、サブディレクトリも含めて名前順に返す", () => {
    const dir = mkdtempSync(join(tmpdir(), "live-spec-"));
    mkdirSync(join(dir, "orders"));
    writeFileSync(join(dir, "b.spec.ts"), "");
    writeFileSync(join(dir, "orders", "a.spec.ts"), "");
    writeFileSync(join(dir, "helper.ts"), "");

    expect(expandSpecPaths([dir])).toEqual([join(dir, "b.spec.ts"), join(dir, "orders", "a.spec.ts")]);
  });

  it("ファイルはそのまま返す", () => {
    expect(expandSpecPaths(["x/a.spec.ts"])).toEqual(["x/a.spec.ts"]);
  });
});

describe("generateProject: 複数のドメインオブジェクトから仕様書を作る", () => {
  const specSource = (status: string) =>
    `/** ${status} の説明 */\nexport type S = { status: "${status}" };\nexport const initial: S = { status: "${status}" };\nexport const actors = { someone: {} };\nexport function noop(s: S) { return s; }\n`;
  const project = () => {
    const dir = mkdtempSync(join(tmpdir(), "live-spec-"));
    writeFileSync(join(dir, "order.spec.ts"), specSource("open"));
    writeFileSync(join(dir, "payment.spec.ts"), specSource("paid"));
    return [join(dir, "order.spec.ts"), join(dir, "payment.spec.ts")];
  };

  it("Markdown は、ドメインオブジェクトごとのファイルと一覧の README.md にする", async () => {
    const out = await generateProject(project(), "markdown");

    expect(out.kind).toBe("files");
    if (out.kind !== "files") return;
    expect(Object.keys(out.files)).toEqual(["README.md", "order.md", "payment.md"]);
    expect(out.files["README.md"]).toContain("[order](order.md)");
    expect(out.files["order.md"]).toContain("# order");
  });

  it("HTML は、すべてのドメインオブジェクトを 1 つのファイルにまとめる", async () => {
    const out = await generateProject(project(), "html");

    expect(out.kind).toBe("text");
    if (out.kind !== "text") return;
    expect(out.content).toContain('href="#/order"');
    expect(out.content).toContain('href="#/payment"');
  });

  it("JSON は、ドメインオブジェクトの一覧にする", async () => {
    const out = await generateProject(project(), "json");

    expect(out.kind === "text" && JSON.parse(out.content).objects.map((o: { name: string }) => o.name)).toEqual(["order", "payment"]);
  });

  it("タイトルは、spec を含むプロジェクトの package.json の name を使う", async () => {
    const dir = mkdtempSync(join(tmpdir(), "live-spec-"));
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "shop" }));
    mkdirSync(join(dir, "specs"));
    writeFileSync(join(dir, "specs", "order.spec.ts"), specSource("open"));
    writeFileSync(join(dir, "specs", "payment.spec.ts"), specSource("paid"));

    const out = await generateProject([join(dir, "specs", "order.spec.ts"), join(dir, "specs", "payment.spec.ts")], "html");

    expect(out.kind === "text" && out.content).toContain("<title>shop — 仕様書</title>");
  });

  it("--title を指定したら、それをタイトルにする", () => {
    expect(parseCliArgs(["specs", "--html", "--title", "ブログ"]).title).toBe("ブログ");
  });

  it("spec が 1 つなら、これまでどおり 1 つのテキストにする", async () => {
    const out = await generateProject(project().slice(0, 1), "markdown");

    expect(out.kind === "text" && out.content.startsWith("# order")).toBe(true);
  });

  it("複数の Markdown を --out なしで出そうとしたら、ディレクトリを指定するよう案内する", async () => {
    const errors: Array<string> = [];

    const code = await runCli(project(), { stdout: () => {}, stderr: (s) => errors.push(s) });

    expect(code).toBe(2);
    expect(errors.join("")).toContain("--out <ディレクトリ>");
  });

  it("複数の Markdown を --out のディレクトリに書き出す", async () => {
    const dir = mkdtempSync(join(tmpdir(), "live-spec-out-"));

    const code = await runCli([...project(), "--out", dir], { stdout: () => {}, stderr: () => {} });

    expect(code).toBe(0);
    expect(readFileSync(join(dir, "payment.md"), "utf8")).toContain("# payment");
  });
});

describe("failureOutput: 監視中に生成に失敗したときに書き出すもの", () => {
  const error = new Error("Expression expected");

  it("Markdown では、古い仕様と取り違えないよう、失敗したことを書いた文書にする", () => {
    const out = failureOutput("markdown", ["specs/a.spec.ts"], error);

    expect(out.kind === "text" && out.content).toContain("# 仕様書を生成できませんでした");
    expect(out.kind === "text" && out.content).toContain("Expression expected");
  });

  it("Markdown をディレクトリに分けて書くときは、一覧の README.md に失敗したことを書く", () => {
    const out = failureOutput("markdown", ["specs/a.spec.ts", "specs/b.spec.ts"], error);

    expect(out.kind === "files" && out.files["README.md"]).toContain("前回の生成のまま");
  });

  it("JSON では、error を持つオブジェクトにする", () => {
    const out = failureOutput("json", ["specs/a.spec.ts"], error);

    expect(out.kind === "text" && JSON.parse(out.content)).toEqual({ error: "Expression expected" });
  });
});

describe("isMain: CLI として起動されたかを判定する", () => {
  it("node <file> で直接起動されたら true", () => {
    const dir = mkdtempSync(join(tmpdir(), "live-spec-"));
    const file = join(dir, "cli.ts");
    writeFileSync(file, "");

    expect(isMain(pathToFileURL(file).href, file)).toBe(true);
  });

  it("node_modules/.bin のシンボリックリンク経由で起動されても true", () => {
    const dir = mkdtempSync(join(tmpdir(), "live-spec-"));
    const file = join(dir, "cli.ts");
    const link = join(dir, "live-spec");
    writeFileSync(file, "");
    symlinkSync(file, link);

    expect(isMain(pathToFileURL(file).href, link)).toBe(true);
  });

  it("import されただけなら false", () => {
    expect(isMain("file:///somewhere/cli.ts", undefined)).toBe(false);
  });
});

describe("runCli: 失敗したときの終わり方", () => {
  const io = () => {
    const out: Array<string> = [];
    const err: Array<string> = [];
    return { out, err, io: { stdout: (s: string) => out.push(s), stderr: (s: string) => err.push(s) } };
  };

  it("引数の誤りは、理由と使い方を出して終了コード 2 を返す", async () => {
    const t = io();

    expect(await runCli(["--html"], t.io)).toBe(2);
    expect(t.err.join("")).toContain("usage:");
  });

  it("spec を読み込めないときは、スタックトレースではなく短いメッセージを出して終了コード 1 を返す", async () => {
    const dir = mkdtempSync(join(tmpdir(), "live-spec-"));
    const path = join(dir, "broken.spec.ts");
    writeFileSync(path, "export const initial = ;\n");
    const t = io();

    expect(await runCli([path], t.io)).toBe(1);
    expect(t.err.join("")).toMatch(/^生成に失敗しました: /);
    expect(t.err.join("")).not.toContain("    at ");
  });

  it("--serve でポートが使用中なら、別の番号を指定するよう案内して終了コード 1 を返す", async () => {
    const blocker = createServer();
    await new Promise<void>((resolve) => blocker.listen(0, "127.0.0.1", resolve));
    const port = (blocker.address() as { port: number }).port;
    const t = io();

    try {
      expect(await runCli(["a.spec.ts", "--serve", "--port", String(port)], t.io)).toBe(1);
      expect(t.err.join("")).toContain(`ポート ${port} は使用中です`);
    } finally {
      blocker.close();
    }
  });
});

describe("renderErrorHtml: 生成に失敗したときのページ", () => {
  it("エラーの内容をエスケープして表示する", () => {
    const html = renderErrorHtml("article", new Error("<script>alert(1)</script>"));

    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>alert(1)");
  });
});
