import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadObject } from "../src/generate.ts";
import { renderHtml } from "../src/render/html.ts";

const INDEX = new URL("../src/index.ts", import.meta.url).pathname;

export const RUN = (extra = "") => `import { ensure } from "${INDEX}";
/** 実行 */
export type Run = {
  /** 実行の段階 */
  status: "待機中" | "実行中" | "一時停止" | "成功" | "停止";
  /** 上限に届いた */
  limited: boolean;
};
type Caller = { kind: "worker" | "operator" };
export const initial: Run = { status: "待機中", limited: false };
export const actors: Record<string, Caller> = { ワーカー: { kind: "worker" }, 運用者: { kind: "operator" } };
/** 始める */
export function start(r: Run, c: Caller): Run { ensure(c.kind === "worker", "ワーカーだけ"); ensure(r.status === "待機中", "待機中のときだけ"); return { ...r, status: "実行中" }; }
/** 失敗を報告する */
export function fail(r: Run, c: Caller): Run { ensure(c.kind === "worker", "ワーカーだけ"); ensure(r.status === "実行中", "実行中のときだけ"); return { status: "待機中", limited: true }; }
/** 成功を報告する */
export function succeed(r: Run, c: Caller): Run { ensure(c.kind === "worker", "ワーカーだけ"); ensure(r.status === "実行中", "実行中のときだけ"); return { ...r, status: "成功" }; }
/** 一時停止する */
export function pause(r: Run, c: Caller): Run { ensure(c.kind === "worker", "ワーカーだけ"); ensure(r.status === "実行中", "実行中のときだけ"); return { ...r, status: "一時停止" }; }
/** 再開する */
export function resume(r: Run, c: Caller): Run { ensure(c.kind === "worker", "ワーカーだけ"); ensure(r.status === "一時停止", "一時停止のときだけ"); return { ...r, status: "実行中" }; }
/** 停止する */
export function stop(r: Run, c: Caller): Run { ensure(c.kind === "operator", "運用者だけ"); ensure(r.status === "待機中" || r.status === "実行中" || r.status === "一時停止", "終わっていないときだけ"); return { status: "停止", limited: true }; }
${extra}
`;

const load = async (extra = "") => {
  const dir = mkdtempSync(join(tmpdir(), "live-spec-views-"));
  writeFileSync(join(dir, "run.spec.ts"), RUN(extra));
  return loadObject(join(dir, "run.spec.ts"));
};

const summarySvg = (html: string) => html.slice(html.indexOf('<div class="diagram diagram-summary">'), html.indexOf("</div>", html.indexOf('<div class="diagram diagram-summary">')));
const count = (text: string, part: string) => text.split(part).length - 1;

describe("状態遷移図の見せ方", { timeout: 60_000 }, () => {
  it("最初の文字列の項目の値ごとに 1 つの箱にまとめた要約の図を、既定で見せる", async () => {
    const { spec, graph } = await load();

    const html = await renderHtml(spec, graph);
    const svg = summarySvg(html);

    expect(graph.states.length).toBeGreaterThan(4);
    expect(count(svg, 'class="node group-node')).toBe(5);
    expect(svg).toContain(">待機中</text>");
    expect(html).toContain('<section class="board" aria-label="状態遷移図" data-mode="summary">');
    expect(html).toContain('<button type="button" data-mode="summary" aria-pressed="true">要約</button><button type="button" data-mode="states" aria-pressed="false">詳細</button>');
  });

  it("要約の図では、同じ箱の組の間の線を 1 本にし、ラベルは先頭の操作とほかの数にする", async () => {
    const { spec, graph } = await load();

    const svg = summarySvg(await renderHtml(spec, graph));

    expect(count(svg, 'data-actions="start fail"')).toBe(1);
    expect(svg).toContain(">始める ほか 1</text>");
  });

  it("spec の diagram.groupBy で、まとめる項目を選べる", async () => {
    const { spec, graph } = await load('export const diagram = { groupBy: "limited" };');

    const svg = summarySvg(await renderHtml(spec, graph));

    expect(count(svg, 'class="node group-node')).toBe(2);
  });

  it("詳細の図では、同じ値の状態を 1 つの枠で囲み、中の状態の名前から枠で分かる値を省く", async () => {
    const { spec, graph } = await load();

    const html = await renderHtml(spec, graph);
    const detail = html.slice(html.indexOf('<div class="diagram diagram-states">'), html.indexOf("</div>", html.indexOf('<div class="diagram diagram-states">')));

    expect(detail).toMatch(/<g class="group-box"><rect [^>]*\/><text [^>]*>待機中<\/text><\/g>/);
    expect(detail).toContain('aria-label="状態 待機中 · limited">');
    expect(detail).toMatch(/aria-label="状態 待機中 · limited">.*?>limited<\/text>/);
  });

  it("変わる値だけにした遷移が同じ文になるものは、操作カードで 1 つにまとめ、元の遷移はホバーで全部見せる", async () => {
    const { spec, graph } = await load();

    const html = await renderHtml(spec, graph);
    const card = html.slice(html.indexOf('data-action="start" tabindex="0"'), html.indexOf("</article>", html.indexOf('data-action="start" tabindex="0"')));

    expect(count(card, ">待機中 → 実行中</span>")).toBe(1);
    expect(card).toContain('title="待機中 → 実行中&#10;待機中 · limited → 実行中 · limited"');
  });

  it("登場人物で絞り込めるよう、線に操作できる人を持たせ、図の上に切り替えを置く", async () => {
    const { spec, graph } = await load();

    const html = await renderHtml(spec, graph);

    expect(html).toContain('<select class="actor-filter"><option value="">すべての人</option><option value="ワーカー">ワーカー</option><option value="運用者">運用者</option></select>');
    expect(html).toMatch(/<g class="edge" data-action="stop" [^>]*data-actors="運用者"/);
  });

  it("詳細の図で枠に入らない状態（その値の状態が 1 つだけ）は、名前から値を省かない", async () => {
    const { spec, graph } = await load();

    const html = await renderHtml(spec, graph);
    const detail = html.slice(html.indexOf('<div class="diagram diagram-states">'), html.indexOf("</div>", html.indexOf('<div class="diagram diagram-states">')));

    expect(detail).toMatch(/aria-label="状態 停止 · limited">.*?>停止 · limited<\/text>/);
  });

  it("要約の図でも、まとめた線の出どころは状態の箱と描き分ける", async () => {
    const { spec, graph } = await load();

    const svg = summarySvg(await renderHtml(spec, graph));

    expect(svg).toMatch(/<g class="any-node">.*?>終わっていないどの状態からでも<\/text>/);
  });
});
