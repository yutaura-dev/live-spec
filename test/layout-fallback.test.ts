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
  it("ごまかさずにエラーにし、ELK の例外を cause に残す", async () => {
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

    const error = await layout(graph).then(
      () => null,
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("状態遷移図を配置できなかった");
    expect((error as Error).message).toContain("live-spec の不具合です");
    expect((error as Error).message).toContain("https://github.com/yutaura-dev/live-spec/issues");
    expect(((error as Error).cause as Error).message).toBe("ELK の中で落ちた");
  });
});
