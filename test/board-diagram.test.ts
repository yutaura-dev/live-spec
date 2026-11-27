import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Script } from "node:vm";
import { describe, expect, it } from "vitest";
import { loadObject } from "../src/generate.ts";
import { collapseTransitions, isCollapsed } from "../src/render/collapse.ts";
import { renderHtml } from "../src/render/html.ts";
import { layout } from "../src/render/layout.ts";

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
  it("一部の状態からだけ出る線は「N つの状態から」にまとめず、どこから来るのかが分かるように描く", async () => {
    const { graph } = await load();

    const moves = collapseTransitions(graph).filter((t) => t.action === "move");

    expect(moves.every((t) => !isCollapsed(t.from))).toBe(true);
  });

  it("状態の組ごとに線を 1 本にし、行き来できる組は両端矢印、一方通行の組は片側矢印にする", async () => {
    const { graph } = await load();
    const label = (id: string) => graph.states.find((s) => s.id === id)!.label;

    const l = await layout(graph);
    const between = (a: string, b: string) =>
      l.edges.filter((e) => [label(e.from), label(e.to)].sort().join("|") === [a, b].sort().join("|"));

    expect(between("要確認", "todo")).toHaveLength(1);
    expect(between("要確認", "todo")[0]!.bidirectional).toBe(true);
    expect(between("完了", "処理中")).toHaveLength(1);
    expect(between("完了", "処理中")[0]!.bidirectional).toBe(false);
  });

  it("線をクリックしたときのために、線に向きごとの操作の一覧を持たせ、両端矢印は始点にも矢じりを付ける", async () => {
    const { spec, graph } = await load();

    const html = await renderHtml(spec, graph);

    const edge = html.match(/<g class="edge" data-action="move" data-actions="move" [^>]*data-bidir="true"[^>]*>\s*<path [^>]*>/)![0];

    expect(edge).toContain("要確認 → todo");
    expect(edge).toContain("todo → 要確認");
    expect(edge).toContain("marker-start=");
  });

  it("生成した HTML のスクリプトは、構文として正しい", async () => {
    const { spec, graph } = await load();

    const html = await renderHtml(spec, graph);
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]!);

    expect(scripts.length).toBeGreaterThan(0);
    for (const s of scripts) expect(() => new Script(s)).not.toThrow();
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
