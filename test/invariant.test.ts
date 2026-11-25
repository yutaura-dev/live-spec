import { describe, expect, it } from "vitest";
import { explore } from "../src/explore.ts";
import { loadSpec } from "../src/load.ts";
import { renderHtml } from "../src/render/html.ts";
import { renderMarkdown } from "../src/render/markdown.ts";
import * as Pinned from "./fixtures/pinned.spec.ts";

const spec = loadSpec("pinned", Pinned);
const graph = explore(spec);

describe("不変条件の検査", { timeout: 30_000 }, () => {
  it("不変条件を破る状態を、初期状態からの最短の手順とともに検出する", () => {
    const violation = graph.findings.find((f) => f.kind === "invariant-violation");

    expect(violation).toEqual({
      kind: "invariant-violation",
      invariant: "固定は公開中の記事だけ",
      state: graph.states.find((s) => s.label === "draft · pinned")!.id,
      path: [
        { action: "publish", actor: "editor" },
        { action: "pin", actor: "editor" },
        { action: "unpublish", actor: "editor" },
      ],
    });
  });

  it("不変条件を満たす状態は検出しない", () => {
    const ok = loadSpec("ok", { ...Pinned, invariants: { 常に真: () => true } });

    expect(explore(ok).findings.filter((f) => f.kind === "invariant-violation")).toEqual([]);
  });

  it("不変条件の関数が例外を投げたら、違反として扱う", () => {
    const broken = loadSpec("broken", {
      ...Pinned,
      invariants: {
        例外を投げる: () => {
          throw new Error("boom");
        },
      },
    });

    expect(explore(broken).findings.filter((f) => f.kind === "invariant-violation").length).toBeGreaterThan(0);
  });

  it("Markdown の検査結果に、破った不変条件と手順を書く", () => {
    expect(renderMarkdown(spec, graph)).toContain(
      "不変条件「固定は公開中の記事だけ」を draft · pinned で破る（publish (editor) → pin (editor) → unpublish (editor)）",
    );
  });

  it("HTML では、不変条件を破る状態のノードに印を付ける", async () => {
    const html = await renderHtml(spec, graph);
    const id = graph.states.find((s) => s.label === "draft · pinned")!.id;

    expect(html).toMatch(new RegExp(`class="node[^"]*violation[^"]*" data-state="${id}"`));
  });
});
