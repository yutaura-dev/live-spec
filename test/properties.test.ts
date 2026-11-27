import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadObject } from "../src/generate.ts";
import { renderHtml } from "../src/render/html.ts";
import { renderMarkdown } from "../src/render/markdown.ts";
import { analyze } from "../src/static.ts";

const INDEX = new URL("../src/index.ts", import.meta.url).pathname;

const SOURCE = `import { ensure } from "${INDEX}";
/** 列 */
export const Status = {
  /** まだ手を付けていない */
  todo: "todo",
  /** 作業中 */
  doing: "進行中",
  /** 終わった */
  done: "完了",
} as const;
export type Status = (typeof Status)[keyof typeof Status];

/** タスク */
export type Task = {
  /** 列 */
  status: Status;
  /** 題名 */
  title: string;
  /** 次にやること */
  nextSteps: string[];
  /** 担当者 */
  ownerId: string;
};
type User = { id: string };
export const initial: Task = { status: "todo", title: "牛乳を買う", nextSteps: [], ownerId: "alice" };
export const actors: Record<string, User> = { 担当のalice: { id: "alice" }, 別の人bob: { id: "bob" } };
export const inputs = { start: { 題名A: ["A"], 題名B: ["B"] } };
/** 始める */
export function start(t: Task, u: User, title: string): Task {
  ensure(u.id === t.ownerId, "担当者だけ");
  ensure(t.status === "todo", "todo のときだけ");
  return { ...t, status: "進行中", title };
}
/** 終える */
export function finish(t: Task, u: User): Task {
  ensure(u.id === t.ownerId, "担当者だけ");
  ensure(t.status === "進行中", "進行中のときだけ");
  return { ...t, status: "完了", nextSteps: ["片付ける"] };
}
export function surface(t: Task, u: User) {
  return null;
}
`;

const load = async () => {
  const dir = mkdtempSync(join(tmpdir(), "live-spec-props-"));
  writeFileSync(join(dir, "task.spec.ts"), SOURCE);
  return loadObject(join(dir, "task.spec.ts"));
};

describe("ドメインオブジェクトのプロパティ", { timeout: 60_000 }, () => {
  it("as const のオブジェクトから値の一覧と値ごとの説明を読む", () => {
    const info = analyze(SOURCE);

    expect(info.fields.status).toEqual(["todo", "進行中", "完了"]);
    expect(info.valueDocs.status).toEqual({ todo: "まだ手を付けていない", 進行中: "作業中", 完了: "終わった" });
  });

  it("値が決まっていない型で、操作などの関数から読まれない項目をデータの項目とする", () => {
    const info = analyze(SOURCE);

    expect(info.dataFields).toEqual(["title", "nextSteps"]);
  });

  it("データの項目は状態の見分けにも名前にも使わず、値が違っても状態を増やさない", async () => {
    const { graph } = await load();

    expect(graph.states.map((s) => s.label)).toEqual(["todo", "進行中", "完了"]);
  });

  it("データの項目は「どの可否にも影響しない項目」の候補に出さない", async () => {
    const { graph } = await load();

    expect((graph.omissions ?? []).filter((h) => h.kind === "unused-field")).toEqual([]);
  });

  it("Markdown にプロパティの表を出し、値ごとの説明と、振る舞いに効くかデータかを示す", async () => {
    const { spec, graph } = await load();

    const md = renderMarkdown(spec, graph);

    expect(md).toContain("## プロパティ");
    expect(md).toContain("| status | `Status` | 列 | 振る舞いに効く | todo（まだ手を付けていない） / 進行中（作業中） / 完了（終わった） |");
    expect(md).toContain("| title | `string` | 題名 | データ |  |");
    expect(md).toContain("| ownerId | `string` | 担当者 | 振る舞いに効く |  |");
  });

  it("HTML にもプロパティの表を出す", async () => {
    const { spec, graph } = await load();

    const html = await renderHtml(spec, graph);

    expect(html).toContain("<h2>プロパティ</h2>");
    expect(html).toContain('<span class="value" title="作業中">進行中</span>');
  });
});
