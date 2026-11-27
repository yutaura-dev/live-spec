import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadObject } from "../src/generate.ts";
import { analyze } from "../src/static.ts";

const INDEX = new URL("../src/index.ts", import.meta.url).pathname;

const SOURCE = `import { ensure } from "${INDEX}";
type Activity = { kind: "appeared" | "resolved" | "reopened"; occurredAt: string };
/** 項目 */
export type Item = {
  state: "open" | "resolved";
  /** 出来事の履歴。どの条件からも読まない */
  history: Activity[];
};
export const initial: Item = { state: "open", history: [] };
export const actors = { 人: {} };
/** 片付ける */
export function resolve(item: Item): Item {
  ensure(item.state === "open", "開いているときだけ");
  return { ...item, state: "resolved", history: [...item.history, { kind: "resolved", occurredAt: "2026-11-28" }] };
}
/** 開き直す */
export function reopen(item: Item): Item {
  ensure(item.state === "resolved", "片付いたときだけ");
  return { ...item, state: "open", history: [...item.history, { kind: "reopened", occurredAt: "2026-11-28" }] };
}
`;

describe("書き足すだけの項目", () => {
  it("同じ項目に写して書き足すためだけに読む項目は、条件で読む項目に数えない", () => {
    const info = analyze(SOURCE);

    expect(info.readFields).not.toContain("history");
    expect(info.dataFields).toContain("history");
  });

  it("書き足すだけの配列は、状態の見分けと名前に使わない", async () => {
    const dir = mkdtempSync(join(tmpdir(), "live-spec-append-"));
    const path = join(dir, "item.spec.ts");
    writeFileSync(path, SOURCE);

    const { graph } = await loadObject(path);

    expect(graph.states.map((s) => s.label).sort()).toEqual(["open", "resolved"]);
  });

  it("写す以外の読み方（長さを見るなど）をしていれば、条件で読む項目に数える", () => {
    const info = analyze(SOURCE.replace('ensure(item.state === "open", "開いているときだけ");', 'ensure(item.history.length < 3, "3 回まで");'));

    expect(info.readFields).toContain("history");
  });
});
