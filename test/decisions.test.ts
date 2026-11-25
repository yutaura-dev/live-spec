import { describe, expect, it } from "vitest";
import { explore } from "../src/explore.ts";
import { loadSpec } from "../src/load.ts";
import { renderHtml } from "../src/render/html.ts";
import { renderMarkdown } from "../src/render/markdown.ts";

type Order = { total: number; member: "一般" | "会員" };
const shipping = (o: Order) => (o.member === "会員" || o.total >= 5000 ? 0 : 500);
const base = { initial: { status: "cart" }, actors: { 客: {} } };
const spec = loadSpec("order", {
  ...base,
  decisions: {
    送料: {
      decide: shipping,
      cases: [
        { input: { total: 4999, member: "一般" }, expect: 500 },
        { input: { total: 5000, member: "一般" }, expect: 0 },
        { input: { total: 100, member: "会員" }, expect: 0 },
      ],
    },
  },
});
const graph = explore(spec);

describe("decisions: ルールの判断表", { timeout: 30_000 }, () => {
  it("decisions を読み、操作には含めない", () => {
    expect(spec.decisions.map(([name]) => name)).toEqual(["送料"]);
    expect(spec.actions).toEqual([]);
  });

  it("入力の例ごとに判断の関数を実行して、条件 × 結果の表を作る", () => {
    expect(graph.decisions).toEqual([
      {
        name: "送料",
        columns: ["total", "member"],
        rows: [
          { input: { total: 4999, member: "一般" }, result: 500, expect: 500, ok: true },
          { input: { total: 5000, member: "一般" }, result: 0, expect: 0, ok: true },
          { input: { total: 100, member: "会員" }, result: 0, expect: 0, ok: true },
        ],
      },
    ]);
  });

  it("期待と違う結果を検出する", () => {
    const s = loadSpec("order", {
      ...base,
      decisions: { 送料: { decide: shipping, cases: [{ input: { total: 5000, member: "一般" }, expect: 500 }] } },
    });

    expect(explore(s).findings).toContainEqual({ kind: "decision-mismatch", decision: "送料", row: 1, expected: "500", actual: "0" });
  });

  it("判断の関数が例外を投げたら検出する", () => {
    const s = loadSpec("order", {
      ...base,
      decisions: {
        送料: {
          decide: () => {
            throw new Error("boom");
          },
          cases: [{ input: { total: 1 } }],
        },
      },
    });

    expect(explore(s).findings).toContainEqual({ kind: "decision-error", decision: "送料", row: 1, message: "boom" });
  });

  it("Markdown に、ルールごとの表を書く", () => {
    const md = renderMarkdown(spec, graph);

    expect(md).toContain("## ルール");
    expect(md).toContain("### 送料\n\n| total | member | 結果 |\n|---|---|---|\n| 4999 | 一般 | 500 |");
  });

  it("HTML に、ルールの表を出す", async () => {
    const html = await renderHtml(spec, graph);

    expect(html).toContain('<section class="decisions"');
    expect(html).toContain("<th>結果</th>");
  });
});
