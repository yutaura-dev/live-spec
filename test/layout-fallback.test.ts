import { describe, expect, it, vi } from "vitest";
import type { Graph } from "../src/model.ts";

vi.mock("elkjs/lib/elk.bundled.js", () => ({
  default: {
    default: class {
      layout(): Promise<never> {
        return Promise.reject(new Error("ELK の中で落ちた"));
      }
    },
  },
}));

const { layout } = await import("../src/render/layout.ts");

const state = (id: string, initial: boolean) => ({ id, label: id, values: {}, initial, terminal: false });

describe("図の配置に失敗したとき", () => {
  it("生成を止めず、状態を並べただけの図と、配置できなかった理由を返す", async () => {
    const graph = {
      states: [state("s0", true), state("s1", false)],
      transitions: [{ from: "s0", to: "s1", action: "go", actors: ["人"] }],
      availability: [],
      findings: [],
      surfaces: [],
      decisions: [],
      links: [],
      questions: [],
      scenarios: [],
    } as unknown as Graph;

    const result = await layout(graph);

    expect(result.nodes.map((n) => n.id)).toEqual(["s0", "s1"]);
    expect(result.edges).toHaveLength(1);
    expect(result.notice).toContain("ELK の中で落ちた");
  });
});
