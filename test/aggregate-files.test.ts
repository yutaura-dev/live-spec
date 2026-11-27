import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadAggregate } from "../src/aggregate.ts";
import { runCli } from "../src/cli.ts";
import { expandAggregatePaths, expandSpecPaths, generateProject } from "../src/generate.ts";
import { isSpecModuleUrl } from "../src/spec-loader.ts";

const INDEX = new URL("../src/index.ts", import.meta.url).pathname;

const ACTION_ITEM = `import { ensure } from "${INDEX}";
/** 計画の中の 1 つの作業 */
export type ActionItem = { status: "todo" | "done" };
export const initial: ActionItem = { status: "todo" };
export const actors = { 人: {} };
/** 済ませる */
export function finishItem(i: ActionItem): ActionItem {
  ensure(i.status === "todo", "まだのときだけ");
  return { status: "done" };
}
export const links = [{ from: finishItem, to: "task", action: "finishPlan", label: "全部済んだら計画を終える" }];
export const reviewed = { "unguarded:finishItem:まだのときだけ": "集約の例なので、条件の意図はここでは問わない" };
`;

const TASK = `import { ensure } from "${INDEX}";
import type { ActionItem } from "./action-item.spec.ts";
/** やること */
export type Task = {
  status: "open" | "closed";
  /** 計画の作業 */
  items: ActionItem[];
};
export const initial: Task = { status: "open", items: [] };
export const actors = { 人: {} };
/** 計画を終える */
export function finishPlan(t: Task): Task {
  ensure(t.status === "open", "開いているときだけ");
  return { ...t, status: "closed" };
}
export const reviewed = { "unguarded:finishPlan:開いているときだけ": "集約の例なので、条件の意図はここでは問わない" };
`;

const AGGREGATE = (entities = '["action-item"]') => `import type { Task } from "./task.spec.ts";
import type { ActionItem } from "./action-item.spec.ts";

/** タスクと、その計画の作業 */
export const displayName = "タスク";
export const root = "task";
export const entities = ${entities};
export const invariants = {
  "終わったタスクには、まだの作業がない": (task: Task, items: ReadonlyArray<ActionItem>) => task.status !== "closed" || items.every((i) => i.status === "done"),
};
`;

const OTHER = `/** 通知 */
export type Notice = { status: "new" | "read" };
export const initial: Notice = { status: "new" };
export const actors = { 人: {} };
/** 読む */
export function read(n: Notice): Notice { return { status: "read" }; }
export const links = [{ from: read, to: "action-item", label: "作業を指す" }];
`;

const project = (files: Record<string, string>) => {
  const dir = mkdtempSync(join(tmpdir(), "live-spec-agg-"));
  mkdirSync(join(dir, "specs"));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, "specs", name), content);
  return join(dir, "specs");
};

const base = (extra: Record<string, string> = {}) =>
  project({ "action-item.spec.ts": ACTION_ITEM, "task.spec.ts": TASK, "task.aggregate.ts": AGGREGATE(), ...extra });

const capture = async (argv: Array<string>) => {
  const out: Array<string> = [];
  const code = await runCli(argv, { stdout: (s) => out.push(s), stderr: (s) => out.push(s) });
  return { code, text: out.join("") };
};

describe("集約のファイル（*.aggregate.ts）", { timeout: 60_000 }, () => {
  it("ディレクトリから、spec とは別に集約のファイルを集め、TypeScript として読む", () => {
    const dir = base();

    expect(expandSpecPaths([dir]).map((p) => p.split("/").pop())).toEqual(["action-item.spec.ts", "task.spec.ts"]);
    expect(expandAggregatePaths([dir]).map((p) => p.split("/").pop())).toEqual(["task.aggregate.ts"]);
    expect(expandSpecPaths([join(dir, "task.aggregate.ts")])).toEqual([]);
    expect(isSpecModuleUrl("file:///a/specs/task.aggregate.ts")).toBe(true);
  });

  it("名前・表示名・説明・ルート・中の Entity・集約をまたぐ決まりを読む", async () => {
    const agg = await loadAggregate(join(base(), "task.aggregate.ts"));

    expect(agg).toMatchObject({
      name: "task",
      displayName: "タスク",
      doc: "タスクと、その計画の作業",
      root: "task",
      entities: ["action-item"],
      invariants: ["終わったタスクには、まだの作業がない"],
    });
  });

  it("HTML では、集約を 1 ページにし、中の Entity をそのページの節として出す", async () => {
    const dir = base();

    const out = await generateProject(expandSpecPaths([dir]), "html", "仕様", [], [], expandAggregatePaths([dir]));

    const html = out.kind === "text" ? out.content : "";
    const tabs = html.slice(html.indexOf('<nav class="tabs"'), html.indexOf("</nav>"));
    expect(tabs).toContain('data-tab="task"');
    expect(tabs).not.toContain('data-tab="action-item"');
    expect(html).toContain('data-page="action-item" data-aggregate="task"');
    expect(html).toContain("<h2>集約の中のつながり</h2>");
    expect(html).toContain("まだ確かめていない決まり");
    expect(html).toContain("終わったタスクには、まだの作業がない");
  });

  it("Markdown では、集約ごとに 1 ファイルにし、中の Entity を節として入れる", async () => {
    const dir = base({ "notice.spec.ts": OTHER.replace("links = [", "linksUnused = [") });

    const out = await generateProject(expandSpecPaths([dir]), "markdown", "仕様", [], [], expandAggregatePaths([dir]));

    const files = out.kind === "files" ? out.files : {};
    expect(Object.keys(files).sort()).toEqual(["README.md", "notice.md", "task.md"]);
    expect(files["task.md"]).toContain("# タスク");
    expect(files["task.md"]).toContain("## 集約の中の Entity: Action Item");
    expect(files["task.md"]).toContain("- 終わったタスクには、まだの作業がない（まだ確かめていない）");
  });

  it("check の結果を集約ごとにまとめて出す", async () => {
    const { code, text } = await capture(["check", base()]);

    expect(text).toContain("集約 タスク\n  ✓ task\n  ✓ action-item\n");
    expect(code).toBe(0);
  });

  it("集約の外の spec が中の Entity を指すと、検査結果に出して check を失敗させる", async () => {
    const { code, text } = await capture(["check", base({ "notice.spec.ts": OTHER })]);

    expect(text).toContain("✗ 集約 タスク: 集約の外の notice が、中の Entity action-item を links で指している（外からはルートの task を指す）");
    expect(code).toBe(1);
  });

  it("中の Entity の名前の誤りは、検査結果に出して check を失敗させる", async () => {
    const dir = project({ "action-item.spec.ts": ACTION_ITEM, "task.spec.ts": TASK, "task.aggregate.ts": AGGREGATE('["action-items"]') });

    const { code, text } = await capture(["check", dir]);

    expect(text).toContain("✗ 集約 タスク: 中の Entity「action-items」の spec が見つからない");
    expect(code).toBe(1);
  });

});
