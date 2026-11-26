import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadObject } from "../src/generate.ts";
import { collapseTransitions, sourceLabel } from "../src/render/collapse.ts";
import { renderHtml } from "../src/render/html.ts";

const INDEX = new URL("../src/index.ts", import.meta.url).pathname;

export const RUN_SPEC = `import { ensure } from "${INDEX}";
/** 実行 */
export type Run = {
  /** 実行の状態 */
  status: "待機中" | "準備中" | "実行中" | "一時停止" | "再試行待ち" | "成功" | "失敗" | "停止";
  /** 投入済み */
  submitted: boolean;
};
export const initial: Run = { status: "待機中", submitted: false };
export const actors = { ワーカー: {} };
export const glossary = { 投入: "ジョブをキューに入れること" };
/** 準備する */
export function prepare(r: Run): Run { ensure(r.status === "待機中", "待機中のときだけ"); return { status: "準備中", submitted: true }; }
/** 始める */
export function start(r: Run): Run { ensure(r.status === "準備中", "準備中のときだけ"); return { ...r, status: "実行中" }; }
/** 一時停止する */
export function pause(r: Run): Run { ensure(r.status === "実行中", "実行中のときだけ"); return { ...r, status: "一時停止" }; }
/** 再開する */
export function resume(r: Run): Run { ensure(r.status === "一時停止", "一時停止のときだけ"); return { ...r, status: "実行中" }; }
/** 失敗を報告する */
export function fail(r: Run): Run { ensure(r.status === "実行中", "実行中のときだけ"); return { ...r, status: "再試行待ち" }; }
/** 再試行する */
export function retry(r: Run): Run { ensure(r.status === "再試行待ち", "再試行待ちのときだけ"); return { ...r, status: "準備中" }; }
/** 成功を報告する */
export function succeed(r: Run): Run { ensure(r.status === "実行中", "実行中のときだけ"); return { ...r, status: "成功" }; }
/** あきらめる */
export function giveUp(r: Run): Run { ensure(r.status === "再試行待ち", "再試行待ちのときだけ"); return { ...r, status: "失敗" }; }
/** 停止する */
export function stop(r: Run): Run {
  ensure(r.status !== "成功" && r.status !== "失敗" && r.status !== "停止", "終わっていないときだけ");
  return { status: "停止", submitted: true };
}
export const scenarios = {
  長い流れ: [
    { do: prepare, by: "ワーカー" }, { do: start, by: "ワーカー" }, { do: pause, by: "ワーカー" }, { do: resume, by: "ワーカー" },
    { do: fail, by: "ワーカー" }, { do: retry, by: "ワーカー" }, { do: start, by: "ワーカー" }, { do: succeed, by: "ワーカー" },
  ],
};
`;

const load = async (extra = "") => {
  const dir = mkdtempSync(join(tmpdir(), "live-spec-html-"));
  writeFileSync(join(dir, "run.spec.ts"), RUN_SPEC + extra);
  return loadObject(join(dir, "run.spec.ts"));
};

describe("HTML の仕様書の見やすさ", { timeout: 60_000 }, () => {
  it("同じ操作で同じ行き先の線が 3 本以上あれば 1 本にまとめ、終わっていない状態すべてからならそう書く", async () => {
    const { graph } = await load();

    const stops = collapseTransitions(graph).filter((t) => t.action === "stop");

    expect(stops).toHaveLength(1);
    expect(sourceLabel(graph, stops[0]!.from)).toBe("終わっていないどの状態からでも");
  });

  it("状態遷移図は縮めずに実寸で出し、はみ出す分は横にスクロールし、ボタンで全体を表示に切り替えられる", async () => {
    const { spec, graph } = await load();

    const html = await renderHtml(spec, graph);

    expect(html).toContain('<button type="button" class="fit-toggle" aria-pressed="false">全体を表示</button>');
    expect(html).toContain(".diagram svg{display:block;margin:0 auto}");
    expect(html).toContain(".diagram.fit svg{max-width:100%;height:auto}");
  });

  it("操作カードの条件は、確かめるもののない条件がなければ畳み、あれば開いて見せる", async () => {
    const { spec, graph } = await load('\nexport const reviewed = { "unguarded:stop:終わっていないときだけ": "停止は画面で確かめる" };\n');

    const html = await renderHtml(spec, graph);

    expect(html).toMatch(/data-action="stop"[\s\S]*?<dt>条件<\/dt><dd><details class="ensures"><summary>1 件<\/summary>/);
    expect(html).toMatch(/data-action="prepare"[\s\S]*?<dt>条件<\/dt><dd><details class="ensures" open><summary>1 件<\/summary>/);
  });

  it("操作カードの遷移は、変わる項目だけを出し、全体はホバーで見せる", async () => {
    const { spec, graph } = await load();

    const html = await renderHtml(spec, graph);

    expect(html).toContain('<span class="flow" title="準備中 · submitted → 実行中 · submitted">準備中 → 実行中</span>');
  });

  it("シナリオの手順の遷移も、変わる項目だけを出し、全体はホバーで見せる", async () => {
    const { spec, graph } = await load();

    const html = await renderHtml(spec, graph);

    expect(html).toContain('<p class="flow" title="実行中 · submitted → 一時停止 · submitted">実行中 → 一時停止</p>');
  });

  it("シナリオの手順は横にはみ出さず、折り返して並べる", async () => {
    const { spec, graph } = await load();

    const html = await renderHtml(spec, graph);

    expect(html).toContain(".storyboard{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr))");
  });

  it("用語は畳んで置き、状態遷移図までの距離を短くする", async () => {
    const { spec, graph } = await load();

    const html = await renderHtml(spec, graph);

    expect(html).toContain('<details class="glossary"><summary>用語（');
  });

  it("操作カードは 2 列以下にして、1 枚の幅を広く取る", async () => {
    const { spec, graph } = await load();

    const html = await renderHtml(spec, graph);

    expect(html).toContain(".cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(520px,1fr))");
  });
});
