import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli.ts";
import { loadObject } from "../src/generate.ts";
import { renderHtml } from "../src/render/html.ts";
import { renderMarkdown } from "../src/render/markdown.ts";
import { reviewItems } from "../src/render/review.ts";
import { linkTests } from "../src/test-links.ts";
import { specOf } from "../src/testing.ts";

const INDEX = new URL("../src/index.ts", import.meta.url).pathname;

const SPEC = (extra = "") => `import { ensure } from "${INDEX}";
export type Todo = { status: "open" | "done"; ownerId: string };
type User = { id: string };
export const initial: Todo = { status: "open", ownerId: "alice" };
export const actors: Record<string, User> = { 作った人alice: { id: "alice" }, 別の人bob: { id: "bob" } };
export const invariants = { 持ち主は変わらない: (t: Todo) => t.ownerId === "alice" };
/** 完了にする */
export function complete(todo: Todo, user: User): Todo {
  ensure(user.id === todo.ownerId, "作った人だけ");
  ensure(todo.status === "open", "未完了のときだけ");
  return { ...todo, status: "done" };
}
/** 完了を取り消す */
export function reopen(todo: Todo, user: User): Todo {
  ensure(user.id === todo.ownerId, "作った人だけ");
  ensure(todo.status === "done", "完了のときだけ");
  return { ...todo, status: "open" };
}
export const scenarios = {
  完了して取り消す: [
    { do: complete, by: "作った人alice" },
    { do: reopen, by: "作った人alice" },
  ],
};
${extra}
`;

const TEST = `import { describe, it } from "vitest";
import { specOf } from "@yutaura/live-spec/testing";
import * as Todo from "../specs/todo.spec.ts";
import { reopen } from "../specs/todo.spec.ts";

describe(specOf(Todo.complete), () => {
  it(specOf(Todo.complete, "作った人だけ"), () => {});
  it(specOf(Todo.complete, "未完了のときだけ"), () => {});
});
it(specOf(reopen, "存在しない理由"), () => {});
it(specOf(Todo, { scenario: "完了して取り消す" }), () => {});
it(specOf(Todo, { invariant: "無い不変条件" }), () => {});
`;

const project = (extra = "") => {
  const dir = mkdtempSync(join(tmpdir(), "live-spec-tests-"));
  mkdirSync(join(dir, "specs"));
  mkdirSync(join(dir, "tests"));
  writeFileSync(join(dir, "specs", "todo.spec.ts"), SPEC(extra));
  writeFileSync(join(dir, "tests", "todo.test.ts"), TEST);
  return { dir, spec: join(dir, "specs", "todo.spec.ts"), tests: join(dir, "tests") };
};

const linked = async (extra = "") => {
  const p = project(extra);
  const [object] = linkTests([await loadObject(p.spec)], [p.tests]);
  return { ...p, ...object! };
};

describe("specOf: テストの名前を spec の項目から作る", () => {
  const complete = (_t: unknown, _u: unknown) => {
    // ensure(…, "作った人だけ") を含む関数の代わり
    return "作った人だけ";
  };

  it("操作だけなら関数名、条件を添えれば関数名と理由をテストの名前にする", () => {
    expect(specOf(complete)).toBe("complete");
    expect(specOf(complete, "作った人だけ")).toBe("complete「作った人だけ」");
  });

  it("操作の関数に無い理由を渡すと、テストを定義する時点で失敗する", () => {
    expect(() => specOf(complete, "編集者だけ")).toThrow("complete に「編集者だけ」という条件が無い");
  });

  it("spec のモジュールとシナリオ・不変条件の名前から、テストの名前を作り、無い名前なら失敗する", () => {
    const mod = { scenarios: { 完了して取り消す: [] }, invariants: { 持ち主は変わらない: () => true } };

    expect(specOf(mod, { scenario: "完了して取り消す" })).toBe("シナリオ「完了して取り消す」");
    expect(specOf(mod, { invariant: "持ち主は変わらない" })).toBe("不変条件「持ち主は変わらない」");
    expect(() => specOf(mod, { scenario: "無い" })).toThrow("シナリオ「無い」が無い");
  });
});

describe("テストと spec の項目を結ぶ", { timeout: 60_000 }, () => {
  it("テストのファイルの specOf の呼び出しを読み、指している spec の項目と場所を集める", async () => {
    const { graph } = await linked();

    expect(graph.tests).toContainEqual({ target: "ensure:complete:作った人だけ", file: expect.stringMatching(/tests\/todo\.test\.ts$/), line: 7 });
    expect(graph.tests).toContainEqual(expect.objectContaining({ target: "action:complete", line: 6 }));
    expect(graph.tests).toContainEqual(expect.objectContaining({ target: "scenario:完了して取り消す", line: 11 }));
  });

  it("spec に無い項目を指すテストは、検査結果に出す", async () => {
    const { graph } = await linked();

    expect(graph.findings).toContainEqual(expect.objectContaining({ kind: "test-link-unknown", target: "ensure:reopen:存在しない理由", line: 10 }));
    expect(graph.findings).toContainEqual(expect.objectContaining({ kind: "test-link-unknown", target: "invariant:無い不変条件", line: 12 }));
  });

  it("どのテストも指していない条件は、確かめてほしい点に出す", async () => {
    const { spec, graph } = await linked();

    const ids = reviewItems(spec, graph).pending.map((i) => i.id);

    expect(ids).toContain("untested:reopen:作った人だけ");
    expect(ids).toContain("untested:reopen:完了のときだけ");
    expect(ids).not.toContain("untested:complete:作った人だけ");
  });

  it("reviewed に書けば、テストのない条件も確認済みにでき、テストを結ばないときは書いても検査結果に出さない", async () => {
    const extra = 'export const reviewed = { "untested:reopen:完了のときだけ": "画面で押せないので API のテストだけ" };';
    const { spec, graph } = await linked(extra);
    const plain = await loadObject(project(extra).spec);

    expect(reviewItems(spec, graph).acknowledged.map((i) => i.id)).toContain("untested:reopen:完了のときだけ");
    expect(plain.graph.findings.filter((f) => f.kind === "reviewed-unmatched")).toEqual([]);
  });

  it("Markdown の条件に、確かめているテストの場所を添える", async () => {
    const { spec, graph } = await linked();

    const md = renderMarkdown(spec, graph);

    expect(md).toMatch(/「作った人だけ」— 通るのは [^\n]*（テスト: [^\n]*tests\/todo\.test\.ts:7）/);
  });

  it("live-spec check --tests は、テストのない条件と spec に無い項目を指すテストがあれば 1 で終わる", async () => {
    const p = project();
    const out: Array<string> = [];

    const code = await runCli(["check", p.spec, "--tests", p.tests], { stdout: (s) => out.push(s), stderr: (s) => out.push(s) });

    expect(code).toBe(1);
    expect(out.join("")).toContain("untested:reopen:作った人だけ");
    expect(out.join("")).toContain("spec に無い項目を指している");
  });

  it("HTML の条件にも、確かめているテストの場所を添える", async () => {
    const { spec, graph } = await linked();

    const html = await renderHtml(spec, graph);

    expect(html).toMatch(/<span class="ensure-tests">テスト: [^<]*tests\/todo\.test\.ts:7<\/span>/);
  });

  it("仕様書を作るときも --tests でテストと結べる", async () => {
    const p = project();
    const out: Array<string> = [];

    await runCli([p.spec, "--tests", p.tests], { stdout: (s) => out.push(s), stderr: (s) => out.push(s) });

    expect(out.join("")).toMatch(/（テスト: [^\n]*tests\/todo\.test\.ts:7）/);
  });
});
