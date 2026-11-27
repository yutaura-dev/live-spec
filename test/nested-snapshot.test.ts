import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadObject } from "../src/generate.ts";

const INDEX = new URL("../src/index.ts", import.meta.url).pathname;

const SOURCE = (expectation: string) => `import { ensure } from "${INDEX}";
type Snapshot = {
  state: "open" | "closed";
  title: string;
  fact: { trusted: string[]; body: string };
};
/** 項目 */
export type Item = { latest: Snapshot };
export const initial: Item = { latest: { state: "open", title: "t", fact: { trusted: [], body: "a" } } };
export const actors = { 人: {} };
export const inputs = { update: { 本文A: ["A"], 本文B: ["B"] } };
/** 中身を書き換える */
export function update(item: Item, _u: {}, body: string): Item {
  ensure(item.latest.state === "open", "開いているときだけ");
  return { ...item, latest: { ...item.latest, fact: { ...item.latest.fact, body } } };
}
/** 閉じる */
export function close(item: Item): Item {
  ensure(item.latest.state === "open", "開いているときだけ");
  return { ...item, latest: { ...item.latest, state: "closed" } };
}
export const scenarios = {
  書き換えて閉じる: [
    { do: update, by: "人", input: "本文A", expect: ${expectation} },
    { do: close, by: "人", expect: { latest: { state: "closed" } } },
  ],
};
export const reviewed = {
  "unguarded:update:開いているときだけ": "例",
  "ignores-input:update": "例",
};
`;

const load = async (expectation: string) => {
  const dir = mkdtempSync(join(tmpdir(), "live-spec-snapshot-"));
  const path = join(dir, "item.spec.ts");
  writeFileSync(path, SOURCE(expectation));
  return loadObject(path);
};

describe("オブジェクトの中の、読まれない項目", () => {
  it("読まれる項目と同じオブジェクトの中にあっても、状態の見分けと名前に使わない", async () => {
    const { graph } = await load('{ latest: { state: "open" } }');

    expect(graph.states.map((s) => s.label).sort()).toEqual(["{ state: closed }", "{ state: open }"]);
  });

  it("シナリオの expect の入れ子のオブジェクトは、書いた項目だけを比べる", async () => {
    const { graph } = await load('{ latest: { state: "open", fact: { body: "A" } } }');

    expect(graph.findings).toEqual([]);
  });

  it("入れ子でも、書いた項目が違えば失敗する", async () => {
    const { graph } = await load('{ latest: { fact: { body: "B" } } }');

    expect(graph.findings.map((f) => f.kind)).toContain("scenario-failed");
  });
});
