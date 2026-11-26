import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadObject } from "../src/generate.ts";
import { renderHtml } from "../src/render/html.ts";
import { renderMarkdown } from "../src/render/markdown.ts";

const INDEX = new URL("../src/index.ts", import.meta.url).pathname;

const SOURCE = `import { ensure } from "${INDEX}";
/** 実行 */
export type Run = {
  /** 実行の状態。待機中から始まる */
  status: "待機中" | "実行中" | "完了";
};
export const initial: Run = { status: "待機中" };
export const actors = { ワーカー: {} };
/** 実行を始める。 */
export function start(r: Run): Run {
  ensure(r.status === "待機中", "待機中のときだけ");
  return { ...r, status: "実行中" };
}
/** 実行を終える */
export function finish(r: Run): Run {
  ensure(r.status === "実行中", "実行中のときだけ");
  return { ...r, status: "完了" };
}
`;

const load = async () => {
  const dir = mkdtempSync(join(tmpdir(), "live-spec-labels-"));
  writeFileSync(join(dir, "run.spec.ts"), SOURCE);
  return loadObject(join(dir, "run.spec.ts"));
};

describe("仕様書の読みやすさ: 型の識別子の代わりに JSDoc の名前を出す", { timeout: 30_000 }, () => {
  it("条件の「通るのは」に、項目名ではなく項目の JSDoc の最初の文を出す", async () => {
    const { spec, graph } = await load();

    const md = renderMarkdown(spec, graph);

    expect(md).toContain("「待機中のときだけ」— 通るのは 実行の状態 が 待機中 のとき");
    expect(md).not.toContain("通るのは status が");
  });

  it("操作の結果に、項目名ではなく項目の JSDoc の最初の文を出す", async () => {
    const { spec, graph } = await load();

    const md = renderMarkdown(spec, graph);
    const html = await renderHtml(spec, graph);

    expect(md).toContain("- **結果**: 実行の状態 → 実行中");
    expect(html).toContain("<dt>結果</dt><dd>実行の状態 → 実行中</dd>");
  });
});
