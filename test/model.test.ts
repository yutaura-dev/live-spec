import { readFileSync } from "node:fs";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { explore } from "../src/explore.ts";
import { loadSpec } from "../src/load.ts";
import { normalize, SpecModel } from "../src/model.ts";
import * as Article from "./fixtures/article.spec.ts";
import { loadArticle } from "./fixtures/load-article.ts";

const spec = loadArticle();
const SOURCE = readFileSync(new URL("./fixtures/article.spec.ts", import.meta.url), "utf8");

describe("normalize: 差分レビュー用の正規化モデル", () => {
  it("関数を含まない JSON になり、SpecModel としてデコードできる", () => {
    const json = JSON.parse(JSON.stringify(normalize(spec, explore(spec))));

    expect(Schema.decodeUnknownSync(SpecModel)(json).actions).toEqual([
      { name: "submit", summary: "レビューに出す" },
      { name: "publish", summary: "公開する" },
      { name: "pin", summary: null },
      { name: "archive", summary: "アーカイブする" },
    ]);
  });

  it("オブジェクトのキーの書き順が違っても、同じ JSON になる", () => {
    const reordered = loadSpec("article", { ...Article, initial: { authorId: "alice", pinned: false, status: "draft" } }, { source: SOURCE });

    expect(JSON.stringify(normalize(reordered, explore(reordered)))).toBe(JSON.stringify(normalize(spec, explore(spec))));
  });

  it("SpecModel から JSON Schema を生成できる", () => {
    expect(JSON.stringify(Schema.toJsonSchemaDocument(SpecModel))).toContain("transitions");
  });
});
