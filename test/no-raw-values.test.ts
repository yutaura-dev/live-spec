import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli.ts";
import { loadObject } from "../src/generate.ts";
import { renderHtml } from "../src/render/html.ts";
import { renderMarkdown } from "../src/render/markdown.ts";

const INDEX = new URL("../src/index.ts", import.meta.url).pathname;

// 項目の値がオブジェクトや配列になる形をひととおり持つ spec。どの出力にも [object Object] や生の JSON が出ないことを確かめる。
const SOURCE = `import { ensure } from "${INDEX}";
/** タスク */
export type Task = {
  /** 状態 */
  status: "todo" | "done";
  /** 繰り返し */
  recurrence: { recurringTaskId: string; period: "daily" | "weekly" } | null;
  /** 元になった項目 */
  sourceItems: Array<{ sourceItemId: string; role: "main" | "sub" }>;
  /** 進み具合 */
  progress: Array<string>;
};
export const initial: Task = { status: "todo", recurrence: null, sourceItems: [], progress: ["todo", "done"] };
export const actors = { 人: {} };
export const inputs = { recur: { 毎日: ["daily"], 毎週: ["weekly"] } };
/** 繰り返しにする */
export function recur(t: Task, _a: object, period: "daily" | "weekly"): Task {
  ensure(t.status === "todo", "todo のときだけ");
  return { ...t, recurrence: { recurringTaskId: "r1", period } };
}
/** 元の項目を足す */
export function addSource(t: Task): Task {
  ensure(t.sourceItems.length === 0, "まだ無いときだけ");
  return { ...t, sourceItems: [{ sourceItemId: "s1", role: "main" }] };
}
/** 終える */
export function complete(t: Task): Task {
  ensure(t.status === "todo", "todo のときだけ");
  ensure(t.recurrence === null || t.recurrence.period !== "daily", "毎日のものは終えられない");
  return { ...t, status: "done" };
}
`;

const RAW = /\[object Object\]|\{"|\["/;

const project = () => {
  const dir = mkdtempSync(join(tmpdir(), "live-spec-raw-"));
  writeFileSync(join(dir, "task.spec.ts"), SOURCE);
  return join(dir, "task.spec.ts");
};

describe("項目の値がオブジェクトや配列でも、出力に [object Object] や生の JSON を出さない", { timeout: 60_000 }, () => {
  it("Markdown", async () => {
    const { spec, graph } = await loadObject(project());

    expect(renderMarkdown(spec, graph)).not.toMatch(RAW);
  });

  it("HTML（ブラウザに渡すデータと線の操作の一覧を除く）", async () => {
    const { spec, graph } = await loadObject(project());

    const html = (await renderHtml(spec, graph))
      .replace(/<script[\s\S]*?<\/script>/g, "")
      .replace(/ data-ops="[^"]*"/g, "")
      .replace(/&quot;/g, '"');

    expect(html).not.toMatch(RAW);
  });

  it("check の出力", async () => {
    const out: Array<string> = [];

    await runCli(["check", project()], { stdout: (s) => out.push(s), stderr: (s) => out.push(s) });

    expect(out.join("")).not.toMatch(RAW);
  });
});
