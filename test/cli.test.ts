import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generate, outputFormatOf, parseCliArgs, specNameOf } from "../src/cli.ts";
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
      path: "a.spec.ts",
      format: "html",
      out: "out/a.html",
      watch: true,
    });
  });

  it("出力先がなければ標準出力に書く（out は null）", () => {
    expect(parseCliArgs(["a.spec.ts"])).toEqual({ path: "a.spec.ts", format: "markdown", out: null, watch: false });
  });

  it("--watch には --out が必要", () => {
    expect(() => parseCliArgs(["a.spec.ts", "--watch"])).toThrow("--watch には --out");
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

describe("renderErrorHtml: 生成に失敗したときのページ", () => {
  it("エラーの内容をエスケープして表示する", () => {
    const html = renderErrorHtml("article", new Error("<script>alert(1)</script>"));

    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>alert(1)");
  });
});
