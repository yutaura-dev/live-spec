import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadObject } from "../src/generate.ts";

const INDEX = new URL("../src/index.ts", import.meta.url).pathname;

const SOURCE = `import { ensure } from "${INDEX}";
type Closure = {
  outcome: "done" | "dismissed";
  /** 閉じた理由。条件では読まない */
  reason: string;
};
/** タスク */
export type Task = { status: "open" | "closed"; closure: Closure | null };
export const initial: Task = { status: "open", closure: null };
export const actors = { 人: {} };
export const inputs = { complete: { 自分で: ["自分で完了にした"], 計画が済んだ: ["計画が全部済んだ"] } };
/** 完了にする */
export function complete(t: Task, _u: {}, reason: string): Task {
  ensure(t.status === "open", "開いているときだけ");
  return { ...t, status: "closed", closure: { outcome: "done", reason } };
}
/** やり直す */
export function reopen(t: Task): Task {
  ensure(t.closure?.outcome === "done", "完了したときだけ");
  return { ...t, status: "open", closure: null };
}
`;

describe("オブジェクトの中のデータの項目", () => {
  it("値が決まっていない型で条件で読まない項目は、オブジェクトの中にあっても状態の見分けに使わない", async () => {
    const dir = mkdtempSync(join(tmpdir(), "live-spec-nested-"));
    const path = join(dir, "task.spec.ts");
    writeFileSync(path, SOURCE);

    const { graph } = await loadObject(path);

    expect(graph.states.map((s) => s.label).sort()).toEqual(["closed · { outcome: done }", "open · closure=なし"]);
    expect(graph.findings).toEqual([]);
  });

  it("値の一覧を持つ項目でも、オブジェクトの中で条件で読まないなら、状態の名前と同じく見分けに使わない", async () => {
    const dir = mkdtempSync(join(tmpdir(), "live-spec-nested-"));
    const path = join(dir, "task.spec.ts");
    writeFileSync(path, SOURCE.replace("reason: string;", 'reason: "自分で完了にした" | "計画が全部済んだ";').replace("reason: string): Task", 'reason: "自分で完了にした" | "計画が全部済んだ"): Task'));

    const { graph } = await loadObject(path);

    expect(graph.states.map((s) => s.label).sort()).toEqual(["closed · { outcome: done }", "open · closure=なし"]);
  });
});
