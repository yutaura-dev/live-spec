import { describe, expect, it } from "vitest";
import { explore } from "../src/explore.ts";
import { loadSpec } from "../src/load.ts";
import { renderHtml } from "../src/render/html.ts";

describe("HTML の操作カード: 長い文字列をカードの幅で折り返す", () => {
  it("カードの中の行は、中身の最小幅で広がらずに折り返す", async () => {
    const spec = loadSpec("x", { initial: { s: "a" }, actors: { p: {} }, go: () => ({ s: "b" }) });

    const html = await renderHtml(spec, explore(spec));

    expect(html).toContain(".card dl{display:grid;grid-template-columns:5.5em minmax(0,1fr)");
    expect(html).toContain(".card dd{margin:0;min-width:0;overflow-wrap:anywhere}");
    expect(html).toMatch(/\.chip,\.state,\.flow\{[^}]*max-width:100%/);
  });
});
