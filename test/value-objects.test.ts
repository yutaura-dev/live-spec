import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadObject } from "../src/generate.ts";
import { renderHtml } from "../src/render/html.ts";
import { renderMarkdown } from "../src/render/markdown.ts";

const INDEX = new URL("../src/index.ts", import.meta.url).pathname;

const SOURCE = `import { ensure } from "${INDEX}";
export type Place = { url: string };
export type Way =
  /** 人がやる */
  | { type: "human"; place: Place | null }
  /** Claude Code がやる */
  | { type: "claude"; trigger: "on_request" | "auto"; workspace: string | null }
  /** 条件が解消したら済む */
  | { type: "wait"; conditionId: string };
/** 次にやること */
export type Item = {
  /** 状態 */
  status: "todo" | "done";
  /** やり方 */
  way: Way;
};
export const initial: Item = { status: "todo", way: { type: "human", place: null } };
export const actors = { 人: {} };
export const variants = [
  { way: { type: "claude", trigger: "auto", workspace: null } },
  { way: { type: "claude", trigger: "on_request", workspace: "w1" } },
  { way: { type: "wait", conditionId: "c1" } },
];
/** 終える */
export function complete(i: Item): Item {
  ensure(i.status === "todo", "todo のときだけ");
  ensure(i.way.type !== "wait", "待つものは手で終えられない");
  ensure(!(i.way.type === "claude" && i.way.trigger === "auto"), "自動のものは手で終えない");
  return { ...i, status: "done" };
}
`;

const load = async () => {
  const dir = mkdtempSync(join(tmpdir(), "live-spec-vo-"));
  writeFileSync(join(dir, "item.spec.ts"), SOURCE);
  return loadObject(join(dir, "item.spec.ts"));
};

describe("値オブジェクト（判別 union）の項目", { timeout: 60_000 }, () => {
  it("状態の名前では、判別子と条件で読む項目の値だけを短く出し、JSON を出さない", async () => {
    const { graph } = await load();

    expect(graph.states.filter((s) => s.initial).map((s) => s.label)).toEqual(["todo · human", "todo · claude:auto", "todo · claude:on_request", "todo · wait"]);
  });

  it("条件の「通るのは」でも、値オブジェクトを短く出す", async () => {
    const { spec, graph } = await load();

    const md = renderMarkdown(spec, graph);

    expect(md).not.toContain("[object Object]");
    expect(md).toContain("「待つものは手で終えられない」— 通るのは やり方 が human, claude:auto, claude:on_request のとき");
  });

  it("プロパティの表で、オブジェクトの型の項目を子の行で展開し、判別 union は種類ごとの行の下に並べる", async () => {
    const { spec, graph } = await load();

    const md = renderMarkdown(spec, graph);
    const html = await renderHtml(spec, graph);

    expect(md).toContain("| way | `Way` | やり方 | 作ったときに決まる |");
    expect(md).toContain("| 　type = human |  | 人がやる |  |");
    expect(md).toContain("| 　　place | `Place \\| null` |  | データ |");
    expect(md).toContain("| 　　　url | `string` |  | データ |");
    expect(md).toContain('| 　　trigger | `"on_request" \\| "auto"` |  | 条件で読む |\n| 　　　`on_request` |  |  |  |\n| 　　　`auto` |  |  |  |');
    expect(html).toContain('<tr class="depth-1 case">');
  });
});
