import { describe, expect, it } from "vitest";
import type { Graph } from "../src/model.ts";
import { layout } from "../src/render/layout.ts";

const state = (id: string, initial: boolean) => ({ id, label: id, values: {}, initial, terminal: false });
const move = (from: string, to: string, action: string) => ({ from, to, action, actors: ["人"] });

describe("初期状態が複数ある図の配置", () => {
  it("初期状態どうしを行き来する遷移があっても、配置できる", async () => {
    const graph = {
      states: [state("s0", true), state("s1", true), state("s2", false)],
      transitions: [move("s0", "s1", "resolve"), move("s1", "s0", "reopen"), move("s1", "s2", "remove")],
      availability: [],
      findings: [],
      surfaces: [],
      decisions: [],
      links: [],
      questions: [],
      scenarios: [],
    } as unknown as Graph;

    const result = await layout(graph);

    expect(result.nodes.map((n) => n.id)).toEqual(["s0", "s1", "s2"]);
  });
});
