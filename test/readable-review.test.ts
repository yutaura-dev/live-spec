import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadObject } from "../src/generate.ts";
import { renderHtml } from "../src/render/html.ts";
import { renderMarkdown } from "../src/render/markdown.ts";

const INDEX = new URL("../src/index.ts", import.meta.url).pathname;

const source = (extra = "") => `import { ensure } from "${INDEX}";
/** 実行 */
export type Run = {
  /** 実行の状態 */
  status: "待機中" | "実行中" | "中断" | "完了";
  /** 最後の試行か */
  last: boolean;
};
export const initial: Run = { status: "待機中", last: false };
export const actors = { ワーカー: {} };
export const inputs = { start: { まだ残る: [false], 最後の試行: [true] } };
export const goals = { 完了: (r: Run) => r.status === "完了" };
export const glossary = { 試行: "ジョブを 1 回実行すること" };
/** 実行を始める */
export function start(r: Run, _w: object, last: boolean): Run {
  ensure(r.status === "待機中", "待機中のときだけ");
  ensure(!r.last, "最後の試行を終えていないときだけ");
  return { status: "実行中", last };
}
/** 一時停止する */
export function pause(r: Run): Run {
  ensure(r.status === "実行中", "実行中のときだけ");
  ensure(r.last, "最後の試行のときだけ");
  return { ...r, status: "中断" };
}
/** 再開する */
export function resume(r: Run): Run {
  ensure(r.status === "中断", "中断のときだけ");
  return { ...r, status: "待機中" };
}
/** 実行を終える */
export function finish(r: Run): Run {
  ensure(r.status === "実行中", "実行中のときだけ");
  return { ...r, status: "完了" };
}
export const scenarios = {
  最後の試行で中断する: [
    { do: start, by: "ワーカー", input: "最後の試行" },
    { do: pause, by: "ワーカー" },
  ],
  実行中は始められない: [
    { do: start, by: "ワーカー", input: "まだ残る" },
    { do: start, by: "ワーカー", input: "まだ残る", denied: "待機中のときだけ" },
  ],
};
${extra}
`;

const QUESTIONS = `export const questions = [
  { ask: "中断した最後の試行は、どう終わらせるのか？", about: { status: "中断", last: true } },
  { ask: "今の動きを写しただけで、正しいとは決めていない", scenario: "最後の試行で中断する" },
];`;

const load = async (extra = QUESTIONS) => {
  const dir = mkdtempSync(join(tmpdir(), "live-spec-review2-"));
  writeFileSync(join(dir, "run.spec.ts"), source(extra));
  return loadObject(join(dir, "run.spec.ts"));
};

describe("仕様書の読みやすさ（第 2 弾）", { timeout: 60_000 }, () => {
  it("できないときの理由は、できる条件であることが分かるように「できるのは、〜だけ」と書く", async () => {
    const { spec, graph } = await load();

    const md = renderMarkdown(spec, graph);
    const html = await renderHtml(spec, graph);

    expect(md).toContain("（できるのは、待機中のときだけ）");
    expect(md).toContain("この操作はできない（できるのは、待機中のときだけ）");
    expect(html).toContain("できるのは、待機中のときだけ");
  });

  it("操作の結果は、変わらない場合もある項目にそう添える", async () => {
    const { spec, graph } = await load();

    const md = renderMarkdown(spec, graph);

    expect(md).toContain("- **結果**: 実行の状態 → 実行中, 最後の試行か → true（変わらない場合もある）");
  });

  it("未決事項が指すシナリオは、通っても ✅ にせず、判断中と示す", async () => {
    const { spec, graph } = await load();

    const md = renderMarkdown(spec, graph);
    const html = await renderHtml(spec, graph);

    expect(md).toContain("### ⚠ 最後の試行で中断する（未決事項 2 を判断中）");
    expect(md).toContain("### ✅ 実行中は始められない");
    expect(html).toContain("<h3>⚠ 最後の試行で中断する（未決事項 2 を判断中）</h3>");
  });

  it("未決事項が指すシナリオが無ければ、検査結果に出す", async () => {
    const { graph } = await load('export const questions = [{ ask: "これでよいか？", scenario: "存在しないシナリオ" }];');

    expect(graph.findings).toContainEqual({ kind: "question-scenario-unknown", ask: "これでよいか？", scenario: "存在しないシナリオ" });
  });

  it("袋小路に入る手順は、関数名ではなく操作の JSDoc の要約で書く", async () => {
    const { spec, graph } = await load();

    const md = renderMarkdown(spec, graph);

    expect(md).toContain("入る手順: 実行を始める（ワーカー、最後の試行） → 一時停止する（ワーカー）");
  });

  it("検査結果がなくても、判断待ちや確かめてほしい点が残っていれば、そう添える", async () => {
    const { spec, graph } = await load();

    const md = renderMarkdown(spec, graph);

    expect(md).toMatch(/問題は見つかりませんでした（ただし、判断待ち 1 件[^）]*を上に挙げている）/);
  });

  it("用語は、未決事項より前に置く", async () => {
    const { spec, graph } = await load();

    const md = renderMarkdown(spec, graph);
    const html = await renderHtml(spec, graph);

    expect(md.indexOf("## 用語")).toBeGreaterThan(-1);
    expect(md.indexOf("## 用語")).toBeLessThan(md.indexOf("## 未決事項"));
    expect(html.indexOf("<h2>用語</h2>")).toBeLessThan(html.indexOf("<h2>未決事項</h2>"));
  });
});
