import { describe, expect, it } from "vitest";
import { explore } from "../src/explore.ts";
import { layout } from "../src/render/layout.ts";
import { loadArticle } from "./fixtures/load-article.ts";

const graph = explore(loadArticle());

// タイムアウトを延ばす理由: ELK は初回の読み込みと初期化に数秒かかり、既定の 5 秒を超えることがあるため。
describe("layout: 状態遷移図の配置を計算する", { timeout: 30_000 }, () => {
  it("すべての状態に、大きさを持つノードを置く", async () => {
    const l = await layout(graph);

    expect(l.nodes.map((n) => n.id)).toEqual(graph.states.map((s) => s.id));
    for (const n of l.nodes) expect(n.width).toBeGreaterThan(0);
  });

  it("すべての遷移に、2 点以上の経路とラベルの位置を与える", async () => {
    const l = await layout(graph);

    expect(l.edges).toHaveLength(graph.transitions.length);
    for (const e of l.edges) expect(e.points.length).toBeGreaterThanOrEqual(2);
  });

  it("初期状態を最も左に置く", async () => {
    const l = await layout(graph);
    const initial = l.nodes.find((n) => n.id === graph.states.find((s) => s.initial)!.id)!;

    for (const n of l.nodes) expect(initial.x).toBeLessThanOrEqual(n.x);
  });

  it("同じグラフからは常に同じ配置になる", async () => {
    expect(JSON.stringify(await layout(graph))).toBe(JSON.stringify(await layout(graph)));
  });
});
