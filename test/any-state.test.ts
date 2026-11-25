import { describe, expect, it } from "vitest";
import { explore } from "../src/explore.ts";
import { loadSpec } from "../src/load.ts";
import { layout } from "../src/render/layout.ts";
import { renderMarkdown } from "../src/render/markdown.ts";
import { summarizeActions } from "../src/render/summary.ts";

// reset はどの状態からでも a に戻す。step は a → b → c と進める。
const spec = loadSpec("any", {
  initial: { s: "a" },
  actors: { p: {} },
  step: (d: { s: string }) => ({ s: d.s === "a" ? "b" : "c" }),
  reset: () => ({ s: "a" }),
});
const graph = explore(spec);

describe("どの状態からでも同じ行き先に移る遷移をまとめる", { timeout: 30_000 }, () => {
  it("操作の「できるとき」を『どの状態からでも → 行き先』の 1 件にする", () => {
    const reset = summarizeActions(spec, graph).find((a) => a.name === "reset")!;

    expect(reset.when).toEqual([{ from: "*", to: "a" }]);
  });

  it("Markdown では『どの状態からでも』と書く", () => {
    expect(renderMarkdown(spec, graph)).toContain("- **できるとき**: どの状態からでも → a");
  });

  it("状態遷移図では、『どの状態からでも』のノードから 1 本の線を引く", async () => {
    const l = await layout(graph);

    expect(l.nodes.map((n) => n.label)).toContain("どの状態からでも");
    expect(l.edges.filter((e) => e.action === "reset")).toHaveLength(1);
  });

  it("一部の状態からだけの遷移はまとめない", () => {
    const step = summarizeActions(spec, graph).find((a) => a.name === "step")!;

    expect(step.when.some((w) => w.from === "*")).toBe(false);
  });
});
