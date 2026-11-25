import { describe, expect, it } from "vitest";
import { explore } from "../src/explore.ts";
import { loadSpec } from "../src/load.ts";
import { renderHtml } from "../src/render/html.ts";
import { ensure } from "../src/index.ts";
import { loadArticle } from "./fixtures/load-article.ts";

const spec = loadArticle();
const html = await renderHtml(spec, explore(spec));

describe("renderHtml: 1 ファイルで完結する HTML の仕様書", () => {
  it("完全な HTML 文書を返す", () => {
    expect(html.startsWith("<!doctype html>")).toBe(true);
  });

  it("状態遷移図を SVG として埋め込み、状態ごとにクリックできるノードを置く", () => {
    expect(html).toContain("<svg");
    for (const s of explore(spec).states) expect(html).toContain(`data-state="${s.id}"`);
  });

  it("操作ごとの節を、JSDoc の説明文つきで出す", () => {
    expect(html).toContain('data-action="publish"');
    expect(html).toContain("公開する");
  });

  it("URL の #state-<id> で、開いたときに状態を選択できる", () => {
    expect(html).toContain('location.hash');
  });

  it("外部のファイルやスクリプトを読み込まない", () => {
    expect(html).not.toMatch(/(?:src|href)="(?:https?:)?\/\//);
  });

  it("spec に含まれる文字列は HTML としてエスケープする", async () => {
    const evil = loadSpec("<img src=x onerror=alert(1)>", {
      initial: { status: "a" },
      actors: { "<b>人</b>": {} },
      act: (s: { status: string }) => {
        ensure(s.status === "b", "</script><script>alert(1)</script>");
        return s;
      },
    });

    const out = await renderHtml(evil, explore(evil));

    expect(out).not.toContain("<img src=x");
    expect(out).not.toContain("<b>人</b>");
    expect(out).not.toContain("</script><script>alert(1)");
  });
});
