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

describe("用語: 項目と値の説明", { timeout: 30_000 }, () => {
  it("状態の型の各項目の JSDoc を、項目の説明として読む", () => {
    expect(analyze(source).fieldDocs).toEqual({ status: "公開の段階", authorId: "著者のユーザー ID" });
  });

  it("glossary を読み、操作には含めない", () => {
    expect(spec.glossary).toEqual(Fixture.glossary);
    expect(spec.actions.map(([n]) => n)).not.toContain("glossary");
  });

  it("Markdown に「用語」の節を作り、項目と値の説明はプロパティの表に並べる", () => {
    const md = renderMarkdown(spec, graph);

    expect(md).toContain("## 用語");
    expect(md).toContain("## プロパティ");
    expect(md).toContain("| status | `\"draft\" \\| \"inReview\" \\| \"published\"` | 公開の段階 | 状態遷移で変わる | draft（著者が書いている途中。読者には見えない） / inReview（編集者のレビューを待っている） / published（読者に公開されている） |");
    expect(md).toContain("- **inReview**: 編集者のレビューを待っている");
  });

  it("HTML の状態遷移図のノードに、状態の名前に含まれる用語の説明を付ける", async () => {
    const html = await renderHtml(spec, graph);

    expect(html).toContain("<title>inReview: 編集者のレビューを待っている</title>");
  });
});
