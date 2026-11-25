import { describe, expect, it } from "vitest";
import { explore } from "../src/explore.ts";
import { api, ui } from "../src/index.ts";
import { loadSpec } from "../src/load.ts";
import { renderMarkdown } from "../src/render/markdown.ts";
import { surfaceToText } from "../src/render/wireframe.ts";
import * as Fixture from "./fixtures/surface.spec.ts";

describe("surfaceToText: 画面をテキストの枠線で描く", () => {
  it("画面のタイトル、項目、ボタンを枠の中に描く", () => {
    const text = surfaceToText(
      ui.screen("記事", ui.badge("draft"), ui.field("タイトル", "はじめて"), ui.section("操作", ui.button("公開する", Fixture.publish))),
      [],
    );

    expect(text).toBe(
      ["┌─ 記事", "│ (draft)", "│ タイトル: [はじめて]", "│ ▸ 操作", "│   [公開する]", "└─"].join("\n"),
    );
  });

  it("押せないボタンと、押しても実行できないボタンを書き分ける", () => {
    const text = surfaceToText(
      ui.screen("記事", ui.button("公開する", Fixture.publish, { disabled: true }), ui.button("公開する", Fixture.publish)),
      ["publish"],
    );

    expect(text).toContain("[公開する]（押せない）");
    expect(text).toContain("[公開する] ⚠ 押しても実行できない");
  });

  it("API の応答はそのままの文字列にする", () => {
    expect(surfaceToText(api.response(404), [])).toBe("HTTP 404");
  });
});

describe("renderMarkdown: 画面の節", { timeout: 30_000 }, () => {
  it("状態ごとに、見る人と画面を書く", () => {
    const spec = loadSpec("surface", Fixture);
    const md = renderMarkdown(spec, explore(spec));

    expect(md).toContain("## 画面");
    expect(md).toContain("### draft\n\neditor, viewer が見る画面:\n\n```text\n┌─ 記事");
  });
});
