import { readFileSync } from "node:fs";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { explore } from "../src/explore.ts";
import { ensure } from "../src/index.ts";
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

  it("同じ状態・同じ操作で全員の結果が同じなら、登場人物と入力をまとめて * にする", () => {
    const s = loadSpec("x", {
      initial: { status: "a" },
      actors: { p: {}, q: {} },
      act: (d: { status: string }) => {
        ensure(d.status === "b", "b のときだけ");
        return d;
      },
    });

    const m = normalize(s, explore(s));

    expect(m.availability).toEqual([
      { state: "s0", action: "act", outcomes: [{ enabled: false, to: null, reason: "b のときだけ", cases: "*" }] },
    ]);
  });

  it("結果が分かれるときは、結果ごとに登場人物と入力を並べる", () => {
    const m = normalize(spec, explore(spec));
    const draftSubmit = m.availability.find((a) => a.state === "s0" && a.action === "submit")!;

    expect(draftSubmit.outcomes).toEqual([
      { enabled: true, to: "s1", reason: null, cases: { alice: "*" } },
      { enabled: false, to: null, reason: "自分の記事だけ", cases: { bob: "*", editor: "*", admin: "*" } },
    ]);
  });

  it("登場人物によって入力ごとの結果が分かれるときは、その人の入力の名前を並べる", () => {
    const s = loadSpec("x", {
      initial: {},
      actors: { p: {} },
      inputs: { act: { 通る: [true], 止まる: [false] } },
      act: (d: object, _a: object, ok: boolean) => {
        ensure(ok, "通る入力だけ");
        return d;
      },
    });

    expect(normalize(s, explore(s)).availability[0]!.outcomes).toEqual([
      { enabled: true, to: "s0", reason: null, cases: { p: ["通る"] } },
      { enabled: false, to: null, reason: "通る入力だけ", cases: { p: ["止まる"] } },
    ]);
  });

  it("まとめた cases を展開できるように、操作ごとの入力の例の名前を持つ", () => {
    const s = loadSpec("x", { initial: {}, actors: { p: {} }, inputs: { act: { 例1: [1], 例2: [2] } }, act: (d: object, _a: object, _n: number) => d });

    expect(normalize(s, explore(s)).inputs).toEqual({ act: ["例1", "例2"] });
  });

  it("SpecModel から JSON Schema を生成できる", () => {
    expect(JSON.stringify(Schema.toJsonSchemaDocument(SpecModel))).toContain("transitions");
  });
});
