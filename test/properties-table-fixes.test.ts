import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadObject } from "../src/generate.ts";
import { renderHtml } from "../src/render/html.ts";
import { renderMarkdown } from "../src/render/markdown.ts";

const INDEX = new URL("../src/index.ts", import.meta.url).pathname;

const SOURCE = `import { ensure } from "${INDEX}";
/** 動かし方 */
export const Trigger = {
  /** 頼まれたら動かす */
  onRequest: "on_request",
  /** 自動で動かす */
  auto: "auto",
} as const;
export type Trigger = (typeof Trigger)[keyof typeof Trigger];
export type Fulfillment =
  /** 人がやる */
  | { type: "human" }
  /** Claude Code がやる */
  | { type: "claude"; trigger: Trigger };
/** 次にやること */
export type Item = {
  /** 状態 */
  status: "todo" | "done";
  /** やり方 */
  fulfillment: Fulfillment;
  /**
   * どの Task の計画に並ぶか
   * @ref task
   */
  taskId: string;
  /** 元になったメモ */
  /** @ref note */
  noteId: string;
};
export const initial: Item = { status: "todo", fulfillment: { type: "human" }, taskId: "t1", noteId: "n1" };
export const actors = { 人: {} };
/** 終える */
export function complete(i: Item): Item {
  ensure(i.status === "todo", "todo のときだけ");
  return { ...i, status: "done" };
}
`;

const load = async () => {
  const dir = mkdtempSync(join(tmpdir(), "live-spec-table-"));
  writeFileSync(join(dir, "item.spec.ts"), SOURCE);
  return loadObject(join(dir, "item.spec.ts"));
};

describe("プロパティの表の不具合", { timeout: 60_000 }, () => {
  it("値の行の class が、値のチップの CSS とぶつからない（行がチップの形に崩れない）", async () => {
    const { spec, graph } = await load();

    const html = await renderHtml(spec, graph);

    expect(html).toContain('<tr class="depth-1 value-row">');
    expect(html).not.toMatch(/<tr class="[^"]*\bvalue(?![-\w])/);
  });

  it("入れ子の項目の as const の値にも、値ごとの説明を出す", async () => {
    const { spec, graph } = await load();

    const md = renderMarkdown(spec, graph);

    expect(md).toContain("| 　　　`auto` |  | 自動で動かす |  |");
  });

  it("説明と @ref を同じ JSDoc に書け、説明の列にタグを出さず、扱いを参照として出す", async () => {
    const { spec, graph } = await load();

    const md = renderMarkdown(spec, graph);

    expect(md).toContain("| taskId | `string` | どの Task の計画に並ぶか | 参照（task） |");
    expect(md).not.toContain("@ref");
  });

  it("説明と @ref を 2 つの JSDoc に分けて書いても、説明を使う", async () => {
    const { spec, graph } = await load();

    const md = renderMarkdown(spec, graph);

    expect(md).toContain("| noteId | `string` | 元になったメモ | 参照（note） |");
  });
});
