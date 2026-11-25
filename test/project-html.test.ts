import { describe, expect, it } from "vitest";
import { explore } from "../src/explore.ts";
import { loadSpec } from "../src/load.ts";
import { renderProjectHtml } from "../src/render/html.ts";
import * as Pinned from "./fixtures/pinned.spec.ts";
import * as Surface from "./fixtures/surface.spec.ts";
import { loadArticle } from "./fixtures/load-article.ts";

const object = (name: string, mod: Record<string, unknown>) => {
  const spec = loadSpec(name, mod);
  return { spec, graph: explore(spec) };
};
const article = loadArticle();
const objects = [{ spec: article, graph: explore(article) }, object("pinned", Pinned), object("surface", Surface)];

describe("renderProjectHtml: ドメインオブジェクトごとのページを持つ 1 つの HTML", { timeout: 30_000 }, () => {
  it("タブから各ドメインオブジェクトのページへ移れる", async () => {
    const html = await renderProjectHtml(objects, { title: "ブログ" });

    expect(html).toContain('<nav class="tabs"');
    for (const name of ["article", "pinned", "surface"]) expect(html).toContain(`href="#/${name}"`);
  });

  it("ドメインオブジェクトごとに、ページの section を持つ", async () => {
    const html = await renderProjectHtml(objects, { title: "ブログ" });

    for (const name of ["article", "pinned", "surface"]) expect(html).toContain(`data-page="${name}"`);
  });

  it("一覧ページに、各ドメインオブジェクトの説明と、状態・操作・検査結果の数を並べる", async () => {
    const html = await renderProjectHtml(objects, { title: "ブログ" });
    const overview = html.slice(html.indexOf('data-page=""'), html.indexOf('data-page="article"'));

    expect(overview).toContain("ブログ記事");
    expect(overview).toContain('href="#/article"');
  });

  it("ページをまたいで同じ id を使わない（図の矢印や画面のテンプレートが衝突しないように）", async () => {
    const html = await renderProjectHtml(objects, { title: "ブログ" });
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);

    expect(ids.length).toBe(new Set(ids).size);
  });

  it("URL の hash（#/<名前>/<状態>）でページと状態を切り替える", async () => {
    const html = await renderProjectHtml(objects, { title: "ブログ" });

    expect(html).toContain("hashchange");
  });

  it("ドメインオブジェクトが 1 つならタブと一覧ページを出さない", async () => {
    const html = await renderProjectHtml(objects.slice(0, 1), { title: "article" });

    expect(html).not.toContain('<nav class="tabs"');
    expect(html).not.toContain('data-page=""');
  });
});
