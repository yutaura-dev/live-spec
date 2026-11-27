import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadObject } from "../src/generate.ts";

const INDEX = new URL("../src/index.ts", import.meta.url).pathname;

// 1 手ずつ進む 30 段の列。振る舞いが同じ状態を見分けるのに、組の分け直しが段の数だけ繰り返される。
const SOURCE = `import { ensure } from "${INDEX}";
type Level = "l0" | "l1" | "l2" | "l3" | "l4" | "l5" | "l6" | "l7" | "l8" | "l9" | "l10" | "l11" | "l12" | "l13" | "l14" | "l15" | "l16" | "l17" | "l18" | "l19" | "l20" | "l21" | "l22" | "l23" | "l24" | "l25" | "l26" | "l27" | "l28" | "l29";
/** 段 */
export type Ladder = { level: Level };
export const initial: Ladder = { level: "l0" };
export const actors = { 人: {} };
const NEXT: Record<string, Level> = { "l0": "l1", "l1": "l2", "l2": "l3", "l3": "l4", "l4": "l5", "l5": "l6", "l6": "l7", "l7": "l8", "l8": "l9", "l9": "l10", "l10": "l11", "l11": "l12", "l12": "l13", "l13": "l14", "l14": "l15", "l15": "l16", "l16": "l17", "l17": "l18", "l18": "l19", "l19": "l20", "l20": "l21", "l21": "l22", "l22": "l23", "l23": "l24", "l24": "l25", "l25": "l26", "l26": "l27", "l27": "l28", "l28": "l29" };
/** 1 段上がる */
export function climb(l: Ladder): Ladder {
  ensure(l.level !== "l29", "上の段があるときだけ");
  return { level: NEXT[l.level]! };
}
`;

describe("振る舞いが同じ状態の検出の規模", () => {
  it("組の分け直しを何度も繰り返す spec でも、文字列が膨らまずに終わる", { timeout: 20_000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "live-spec-eq-"));
    const path = join(dir, "ladder.spec.ts");
    writeFileSync(path, SOURCE);

    const { graph } = await loadObject(path);

    expect(graph.states).toHaveLength(30);
  });
});
