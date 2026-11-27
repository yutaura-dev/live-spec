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

  it("Markdown にプロパティの表を出し、値ごとの説明と、項目の扱い（状態遷移で変わる・作ったときに決まる・データ）を示す", async () => {
    const { spec, graph } = await load();

    const md = renderMarkdown(spec, graph);

    expect(md).toContain("## プロパティ");
    expect(md).toContain("| status | `Status` | 列 | 状態遷移で変わる | todo（まだ手を付けていない） / 進行中（作業中） / 完了（終わった） |");
    expect(md).toContain("| title | `string` | 題名 | データ |  |");
    expect(md).toContain("| ownerId | `string` | 担当者 | 作ったときに決まる |  |");
  });

  it("HTML にもプロパティの表を出す", async () => {
    const { spec, graph } = await load();

    const html = await renderHtml(spec, graph);

    expect(html).toContain("<h2>プロパティ</h2>");
    expect(html).toContain('<span class="value" title="作業中">進行中</span>');
  });
});

const ITEM = (extra = "") => `import { ensure } from "${INDEX}";
/** 次にやること */
export type Item = {
  /** 状態 */
  status: "todo" | "done";
  /** 種類 */
  kind: "manual" | "wait" | "merge";
  /** 担当 */
  assignee: "human" | "claude";
  /** 手間 */
  effort: "easy" | "hard";
  /** 題名 */
  title: string;
};
type Actor = { kind: "human" | "claude" };
export const initial: Item = { status: "todo", kind: "manual", assignee: "human", effort: "easy", title: "x" };
export const actors: Record<string, Actor> = { 人: { kind: "human" }, Claude: { kind: "claude" } };
/** 終える */
export function complete(i: Item, a: Actor): Item {
  ensure(a.kind === i.assignee, "担当だけ");
  ensure(i.status === "todo", "todo のときだけ");
  ensure(i.kind !== "wait", "待つものは手で終えられない");
  return { ...i, status: "done" };
}
${extra}
`;

const loadItem = async (extra = "") => {
  const dir = mkdtempSync(join(tmpdir(), "live-spec-item-"));
  writeFileSync(join(dir, "item.spec.ts"), ITEM(extra));
  return loadObject(join(dir, "item.spec.ts"));
};

describe("作ったときに決まる値", { timeout: 60_000 }, () => {
  it("条件で読むが、どの操作も書き換えない項目を「作ったときに決まる値」、読まれない値の一覧の項目もデータとする", () => {
    const info = analyze(ITEM());

    expect(info.creationFields).toEqual(["kind", "assignee"]);
    expect(info.dataFields).toEqual(["effort", "title"]);
  });

  it("作ったときに決まる値は、項目ごとに 1 つずつ値を変えた初期状態から探索し、到達しない値や影響しない項目として出さない", async () => {
    const { graph } = await loadItem();

    expect(graph.states.filter((s) => s.initial).map((s) => s.label)).toEqual(["todo · manual · human", "todo · wait · human", "todo · merge · human", "todo · manual · claude"]);
    expect(graph.findings.filter((f) => f.kind === "unreachable-value")).toEqual([]);
    expect((graph.omissions ?? []).filter((h) => h.kind === "unused-field")).toEqual([]);
  });

  it("組み合わせで振る舞いが変わる値は、variants に書くと、その組み合わせの初期状態も探索する", async () => {
    const { graph } = await loadItem('export const variants = [{ kind: "wait", assignee: "claude" }];');

    expect(graph.states.filter((s) => s.initial).map((s) => s.label)).toContain("todo · wait · claude");
  });

  it("プロパティの表で、状態遷移で変わる・作ったときに決まる・データを分けて示す", async () => {
    const { spec, graph } = await loadItem();

    const md = renderMarkdown(spec, graph);

    expect(md).toContain("| status | \`\"todo\" \\| \"done\"\` | 状態 | 状態遷移で変わる |");
    expect(md).toContain("| kind | \`\"manual\" \\| \"wait\" \\| \"merge\"\` | 種類 | 作ったときに決まる |");
    expect(md).toContain("| effort | \`\"easy\" \\| \"hard\"\` | 手間 | データ |");
  });

  it("シナリオを、作ったときに決まる値を変えた初期状態から始められ、仕様書にどこから始めたかを出す", async () => {
    const { spec, graph } = await loadItem(`export const scenarios = {
  待つものは手で終えられない: { given: { kind: "wait" }, steps: [{ do: complete, by: "人", denied: "待つものは手で終えられない" }] },
};`);

    expect(graph.scenarios[0]).toMatchObject({ name: "待つものは手で終えられない", passed: true, given: { kind: "wait" } });
    expect(graph.ensures!.find((e) => e.reason === "待つものは手で終えられない")!.verdict).toBe("caught");
    expect(renderMarkdown(spec, graph)).toContain("### ✅ 待つものは手で終えられない（kind: wait から）");
  });

  it("given に書けるのは作ったときに決まる値だけで、探索していない組み合わせなら variants に足すよう案内する", async () => {
    const { graph } = await loadItem(`export const scenarios = {
  状態から始める: { given: { status: "done" }, steps: [{ do: complete, by: "人" }] },
  組み合わせ: { given: { kind: "wait", assignee: "claude" }, steps: [{ do: complete, by: "Claude" }] },
};`);

    const reasons = graph.findings.flatMap((f) => (f.kind === "scenario-failed" ? [[f.scenario, f.reason]] : []));
    expect(reasons).toContainEqual(["状態から始める", "given に書けるのは、作ったときに決まる値（kind・assignee）だけ。status は書けない"]);
    expect(reasons).toContainEqual(["組み合わせ", "given の組み合わせ（kind: wait、assignee: claude）は探索していない。export const variants に足す"]);
  });
});
