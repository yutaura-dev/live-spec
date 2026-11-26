import { describe, expect, it } from "vitest";
import { explore } from "../src/explore.ts";
import { loadSpec } from "../src/load.ts";
import { unionGraph } from "../src/render/union.ts";

type Run = { status: "queued" | "running"; dispatch: "未手配" | "手配済み"; urgent: boolean };

const dispatchRun = (r: Run): Run => ({ ...r, dispatch: "手配済み" });
const startRun = (r: Run): Run => ({ ...r, status: "running", urgent: true });

describe("重ね合わせた状態遷移図: 状態は値で突き合わせる", () => {
  it("initial の書き順だけが違っても、すべての状態と遷移が「変わらない」になる", () => {
    const make = (initial: Record<string, unknown>) => {
      const s = loadSpec("run", { initial, actors: { 誰か: {} }, dispatchRun, startRun });
      return explore(s);
    };

    const { nodes, edges } = unionGraph(
      make({ status: "queued", dispatch: "未手配", urgent: false }),
      make({ dispatch: "未手配", status: "queued", urgent: false }),
    );

    expect(nodes.every((n) => n.status === "kept")).toBe(true);
    expect(edges.every((e) => e.status === "kept")).toBe(true);
    expect(nodes.map((n) => n.label)).toContain("未手配 · queued");
  });
});

describe("状態の名前: 項目は initial に書いた順に並べる", () => {
  it("キー名のアルファベット順ではなく、initial のキーの順に並べる", () => {
    const spec = loadSpec("run", {
      initial: { status: "queued", dispatch: "未手配", urgent: false },
      actors: { 誰か: {} },
      dispatchRun,
      startRun,
    });

    const labels = explore(spec).states.map((s) => s.label);

    expect(labels).toContain("queued · 未手配");
    expect(labels).toContain("running · 手配済み · urgent");
  });

  it("真偽値の項目を先に書けば、先に並ぶ", () => {
    const spec = loadSpec("run", {
      initial: { urgent: false, status: "queued", dispatch: "未手配" },
      actors: { 誰か: {} },
      dispatchRun,
      startRun,
    });

    const labels = explore(spec).states.map((s) => s.label);

    expect(labels).toContain("urgent · running · 未手配");
  });
});
