import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadObject } from "../src/generate.ts";
import { collapseTransitions, isCollapsed } from "../src/render/collapse.ts";

const INDEX = new URL("../src/index.ts", import.meta.url).pathname;

const TASK = (extra = "") => `import { ensure } from "${INDEX}";
/** タスク */
export type Task = { status: "要確認" | "todo" | "進行中" | "完了" | "処理中" | "アーカイブ" };
type Caller = { kind: "user" | "sync" };
export const initial: Task = { status: "要確認" };
export const actors: Record<string, Caller> = { 利用者: { kind: "user" }, 同期: { kind: "sync" } };
export const inputs = { move: { 要確認へ: ["要確認"], todoへ: ["todo"], 進行中へ: ["進行中"], 完了へ: ["完了"] } };
/** 列を移す */
export function move(t: Task, c: Caller, to: "要確認" | "todo" | "進行中" | "完了"): Task {
  ensure(c.kind === "user", "利用者だけ");
  ensure(t.status !== "処理中" && t.status !== "アーカイブ", "動かせる列にあるときだけ");
  return { status: to };
}
/** 処理を始める */
export function startSync(t: Task, c: Caller): Task {
  ensure(c.kind === "sync", "同期だけ");
  ensure(t.status === "完了", "完了のときだけ");
  return { status: "処理中" };
}
/** 処理を終える */
export function finishSync(t: Task, c: Caller): Task {
  ensure(c.kind === "sync", "同期だけ");
  ensure(t.status === "処理中", "処理中のときだけ");
  return { status: "アーカイブ" };
}
${extra}
`;

const load = async (extra = "") => {
  const dir = mkdtempSync(join(tmpdir(), "live-spec-board-"));
  writeFileSync(join(dir, "task.spec.ts"), TASK(extra));
  return loadObject(join(dir, "task.spec.ts"));
};

describe("列をどこへでも移せる操作の図と、振る舞いの同じ状態", { timeout: 60_000 }, () => {
  it("出どころの組み合わせが同じ線は、行き先が違っても 1 つの「N つの状態から」にまとめる", async () => {
    const { graph } = await load();

    const moves = collapseTransitions(graph).filter((t) => t.action === "move");

    expect(moves.length).toBe(4);
    expect(new Set(moves.map((t) => t.from)).size).toBe(1);
    expect(isCollapsed(moves[0]!.from)).toBe(true);
  });

  it("どの操作・登場人物・入力でも、できる／できないと行き先が同じ状態を「確かめてほしい点」に出す", async () => {
    const { graph } = await load();

    const hints = (graph.omissions ?? []).filter((h) => h.kind === "equivalent-states");

    expect(hints).toEqual([
      expect.objectContaining({
        id: "equivalent-states:要確認/todo/進行中",
        message: expect.stringContaining("状態「要確認」「todo」「進行中」は、どの操作・登場人物・入力でも、できる／できないと行き先が同じ"),
      }),
    ]);
  });

  it("画面が違う状態は、振る舞いが同じとはみなさない", async () => {
    const { graph } = await load(`import { ui } from "${INDEX}";
export function surface(t: Task, c: Caller) {
  return c.kind === "user" ? ui.screen(t.status === "進行中" ? "作業中のタスク" : "タスク", ui.button("移す", move)) : null;
}`);

    const hints = (graph.omissions ?? []).filter((h) => h.kind === "equivalent-states");

    expect(hints.map((h) => h.id)).toEqual(["equivalent-states:要確認/todo"]);
  });
});
