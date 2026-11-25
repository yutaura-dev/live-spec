import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadObject } from "../src/generate.ts";
import { renderHtml } from "../src/render/html.ts";
import { renderMarkdown } from "../src/render/markdown.ts";

const INDEX = new URL("../src/index.ts", import.meta.url).pathname;

const source = (reviewed: string) => `import { ensure } from "${INDEX}";
/** 文書 */
export type Doc = { status: "draft" | "published"; flagged: boolean };
type User = { role: "author" | "editor" };
export const initial: Doc = { status: "draft", flagged: false };
export const actors: Record<string, User> = { 著者alice: { role: "author" }, 編集者eve: { role: "editor" } };
/** 印を付ける */
export function flag(d: Doc, u: User): Doc {
  ensure(u.role === "author", "著者だけ");
  return { ...d, flagged: !d.flagged };
}
/** 公開する */
export function publish(d: Doc, u: User): Doc {
  ensure(u.role === "editor", "編集者だけ");
  ensure(d.status === "draft", "下書きのときだけ");
  return { ...d, status: "published" };
}
${reviewed}
`;

const load = async (reviewed = "") => {
  const dir = mkdtempSync(join(tmpdir(), "live-spec-review-"));
  writeFileSync(join(dir, "doc.spec.ts"), source(reviewed));
  return loadObject(join(dir, "doc.spec.ts"));
};

describe("確かめてほしい点: 漏れの候補と、意図がほかに書かれていない条件を、ID つきでページの上部に出す", { timeout: 30_000 }, () => {
  it("Markdown の上部に、候補を ID つきで出す", async () => {
    const { spec, graph } = await load();

    const md = renderMarkdown(spec, graph);

    expect(md).toContain("## 確かめてほしい点");
    expect(md).toContain("状態の項目 flagged は、値を変えても、どの操作の可否も変わらない。この項目を使う条件を書き忘れていないか（`unused-field:flagged`）");
    expect(md).toContain("（`unguarded:publish:編集者だけ`）");
  });

  it("操作の節の条件に、理由と、実際に通るときと、外したときの効き目を並べる", async () => {
    const { spec, graph } = await load();

    const md = renderMarkdown(spec, graph);

    expect(md).toContain("- **条件**:");
    expect(md).toContain("  - ⚠ 「編集者だけ」— 通るのは 編集者eve のとき。外すと、");
    expect(md).toContain("  - ⚠ 「下書きのときだけ」— 通るのは status が draft のとき。");
  });

  it("reviewed に書いた候補は「確かめてほしい点」から外し、「確認済み」に理由つきで残す", async () => {
    const { spec, graph } = await load('export const reviewed = { "unused-field:flagged": "印は表示だけに使う" };');

    const md = renderMarkdown(spec, graph);

    expect(md).not.toContain("（`unused-field:flagged`）\n");
    expect(md).toContain("### 確認済み");
    expect(md).toContain("- `unused-field:flagged`: 印は表示だけに使う");
  });

  it("どの候補にも当たらない reviewed のキーは、検査結果に出す", async () => {
    const { graph } = await load('export const reviewed = { "anytime:nothing": "古い" };');

    expect(graph.findings).toContainEqual({ kind: "reviewed-unmatched", id: "anytime:nothing" });
  });

  it("HTML の上部にも、確かめてほしい点を出す", async () => {
    const { spec, graph } = await load();

    const html = await renderHtml(spec, graph);

    expect(html).toContain("確かめてほしい点");
    expect(html).toContain("unused-field:flagged");
  });
});
