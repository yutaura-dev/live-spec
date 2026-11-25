import { describe, expect, it } from "vitest";
import { explore } from "../src/explore.ts";
import { ui } from "../src/index.ts";
import { loadSpec } from "../src/load.ts";
import { renderHtml } from "../src/render/html.ts";
import { layout } from "../src/render/layout.ts";
import { surfaceToHtml } from "../src/render/wireframe.ts";
import * as Fixture from "./fixtures/surface.spec.ts";

const spec = loadSpec("surface", Fixture);
const graph = explore(spec);

describe("surfaceToHtml: ワイヤーフレームを HTML にする", () => {
  it("画面のタイトルと子要素を描く", () => {
    const html = surfaceToHtml(ui.screen("記事", ui.text("本文")), []);

    expect(html).toBe('<div class="wf-screen"><div class="wf-title">記事</div><div class="wf-body"><p class="wf-text">本文</p></div></div>');
  });

  it("押しても実行できないボタンに印を付ける", () => {
    const html = surfaceToHtml(ui.button("公開する", Fixture.publish), ["publish"]);

    expect(html).toContain('class="wf-button is-invalid"');
  });

  it("disabled のボタンには、実行できなくても印を付けない", () => {
    const html = surfaceToHtml(ui.button("公開する", Fixture.publish, { disabled: true }), ["publish"]);

    expect(html).toContain('class="wf-button is-disabled"');
    expect(html).not.toContain("is-invalid");
  });

  it("文言をエスケープする", () => {
    expect(surfaceToHtml(ui.text("<img src=x onerror=alert(1)>"), [])).not.toContain("<img");
  });
});

describe("layout: ノードの大きさを指定できる", { timeout: 30_000 }, () => {
  it("nodeSize を渡すと、すべてのノードをその大きさにする", async () => {
    const l = await layout(graph, { nodeSize: { width: 240, height: 180 } });

    for (const n of l.nodes) expect([n.width, n.height]).toEqual([240, 180]);
  });
});

describe("renderHtml: wireflow 表示", { timeout: 30_000 }, () => {
  it("surface がある spec では、状態ごとに画面のサムネイルを並べた図を出す", async () => {
    const html = await renderHtml(spec, graph);

    expect(html).toContain('<div class="diagram diagram-wireflow">');
    expect(html.match(/<foreignObject/g)?.length).toBe(graph.states.length);
  });

  it("サムネイルは登場人物ごとに用意し、視点を切り替えられるようにする", async () => {
    const html = await renderHtml(spec, graph);

    expect(html).toContain('data-actor="editor"');
    expect(html).toContain('data-actor="viewer"');
    expect(html).toContain('class="viewpoint-select"');
  });

  it("surface がない spec では wireflow を出さない", async () => {
    const { surface: _omit, ...rest } = Fixture;
    const plain = loadSpec("plain", rest);

    expect(await renderHtml(plain, explore(plain))).not.toContain('<div class="diagram diagram-wireflow">');
  });
});
