import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ensure } from "../src/ensure.ts";
import { loadObject } from "../src/generate.ts";
import { renderMarkdown } from "../src/render/markdown.ts";
import { renderHtml } from "../src/render/html.ts";
import { analyze } from "../src/static.ts";

const INDEX = new URL("../src/index.ts", import.meta.url).pathname;

const SOURCE = `import { ensure } from "${INDEX}";
/** 文書 */
export type Doc = { status: "draft" | "published"; approved: boolean };
type User = { role: "author" | "editor" };
export const initial: Doc = { status: "draft", approved: false };
export const actors: Record<string, User> = { 著者alice: { role: "author" }, 編集者eve: { role: "editor" } };
export const invariants = { 公開した文書は承認済み: (d: Doc) => d.status !== "published" || d.approved };
/** 承認する */
export function approve(d: Doc, u: User): Doc {
  ensure(u.role === "editor", "編集者だけ");
  ensure(d.status === "draft" && !d.approved, "未承認の下書きだけ");
  return { ...d, approved: true };
}
/** 公開する */
export function publish(d: Doc, u: User): Doc {
  ensure(u.role === "editor", "編集者だけ");
  ensure(u.role !== "author", "著者は公開できない");
  ensure(d.approved, "承認済みのときだけ");
  ensure(d.status === "draft", "下書きのときだけ");
  return { ...d, status: "published" };
}
`;

const load = async () => {
  const dir = mkdtempSync(join(tmpdir(), "live-spec-mutation-"));
  writeFileSync(join(dir, "doc.spec.ts"), SOURCE);
  return loadObject(join(dir, "doc.spec.ts"));
};

describe("静的解析: 操作ごとの ensure", () => {
  it("操作の関数の中の ensure を、理由と行番号つきで、書かれた順に集める", () => {
    const info = analyze(SOURCE);

    expect(info.ensures.approve).toEqual([
      { reason: "編集者だけ", line: 10 },
      { reason: "未承認の下書きだけ", line: 11 },
    ]);
    expect(info.ensures.publish!.map((e) => e.reason)).toEqual(["編集者だけ", "著者は公開できない", "承認済みのときだけ", "下書きのときだけ"]);
  });
});

describe("ensure のミューテーション: 1 つずつ外して探索し直し、何かが気づくかを見る", { timeout: 30_000 }, () => {
  const object = load();
  const check = async (action: string, reason: string) =>
    (await object).graph.ensures!.find((e) => e.action === action && e.reason === reason)!;

  it("外すと不変条件が破れる ensure は「気づくものがある」とし、気づいたものを挙げる", async () => {
    const c = await check("publish", "承認済みのときだけ");

    expect(c.verdict).toBe("caught");
    expect(c.caughtBy).toEqual(["不変条件「公開した文書は承認済み」"]);
  });

  it("外すと振る舞いが変わるのに何も気づかない ensure は「気づくものがない」とし、外したときに起きることを挙げる", async () => {
    const c = await check("approve", "編集者だけ");

    expect(c.verdict).toBe("unguarded");
    expect(c.caughtBy).toEqual([]);
    expect(c.effects.map((e) => e.actor)).toContain("著者alice");
  });

  it("ほかの ensure と重なっていて、外しても振る舞いが変わらないものは「効いていない」とする", async () => {
    const c = await check("publish", "著者は公開できない");

    expect(c.verdict).toBe("no-effect");
    expect(c.effects).toEqual([]);
  });

  it("同じ理由の ensure がほかの操作にあっても、外すのは対象の操作の ensure だけ", async () => {
    const c = await check("approve", "編集者だけ");

    expect(c.effects.every((e) => e.action === "approve")).toBe(true);
  });

  it("調べ終わったあとは、ensure が元どおり止める", async () => {
    await object;

    expect(() => ensure(false, "編集者だけ")).toThrow("編集者だけ");
  });

  it("Markdown の操作の節に、条件ごとの効き目を出す", async () => {
    const { spec, graph } = await object;

    const md = renderMarkdown(spec, graph);

    expect(md).toContain("- **条件**:");
    expect(md).toContain("⚠ 「編集者だけ」— 通るのは 編集者eve のとき。外すと、著者alice が");
    expect(md).toContain("「承認済みのときだけ」— 通るのは approved が true のとき。外すと、不変条件「公開した文書は承認済み」が気づく");
    expect(md).toContain("外しても振る舞いが変わらない（ほかの条件と重なっている）");
  });

  it("HTML の操作カードにも、条件ごとの効き目を出す", async () => {
    const { spec, graph } = await object;

    const html = await renderHtml(spec, graph);

    expect(html).toContain("<dt>条件</dt>");
    expect(html).toContain('class="ensure unguarded"');
  });
});
