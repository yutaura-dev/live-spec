import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { explore } from "../src/explore.ts";
import { loadSpec } from "../src/load.ts";
import { renderHtml } from "../src/render/html.ts";
import { renderMarkdown } from "../src/render/markdown.ts";
import { analyze } from "../src/static.ts";
import * as Fixture from "./fixtures/glossary.spec.ts";

const source = readFileSync(new URL("./fixtures/glossary.spec.ts", import.meta.url), "utf8");
const spec = loadSpec("article", Fixture, { source });
const graph = explore(spec);

describe("根拠: spec に書いたコードの場所を仕様書に出す", { timeout: 30_000 }, () => {
  it("操作の関数の中にある「// 根拠:」のコメントを、その操作の根拠として読む", () => {
    expect(analyze(source).evidence).toEqual({
      submit: ["src/articles/routes.ts:42（requireAuthor）", "src/articles/service.ts:88-90"],
    });
  });

  it("Markdown の操作の節に根拠を書く", () => {
    expect(renderMarkdown(spec, graph)).toContain("- **根拠**: `src/articles/routes.ts:42`（requireAuthor）、`src/articles/service.ts:88-90`");
  });

  it("HTML の操作カードに根拠を出す", async () => {
    const html = await renderHtml(spec, graph);

    expect(html).toContain('<code class="evidence">src/articles/routes.ts:42</code>');
  });
});

describe("用語: 項目と値の説明", { timeout: 30_000 }, () => {
  it("状態の型の各項目の JSDoc を、項目の説明として読む", () => {
    expect(analyze(source).fieldDocs).toEqual({ status: "公開の段階", authorId: "著者のユーザー ID" });
  });

  it("glossary を読み、操作には含めない", () => {
    expect(spec.glossary).toEqual(Fixture.glossary);
    expect(spec.actions.map(([n]) => n)).not.toContain("glossary");
  });

  it("Markdown に「用語」の節を作り、項目と値の説明を並べる", () => {
    const md = renderMarkdown(spec, graph);

    expect(md).toContain("## 用語");
    expect(md).toContain("- **status**（項目）: 公開の段階。値: draft / inReview / published");
    expect(md).toContain("- **inReview**: 編集者のレビューを待っている");
  });

  it("HTML の状態遷移図のノードに、状態の名前に含まれる用語の説明を付ける", async () => {
    const html = await renderHtml(spec, graph);

    expect(html).toContain("<title>inReview: 編集者のレビューを待っている</title>");
  });
});
