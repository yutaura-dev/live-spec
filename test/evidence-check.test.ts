import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadObject } from "../src/generate.ts";

const INDEX = new URL("../src/index.ts", import.meta.url).pathname;

const specSource = (evidence: Array<string>, extra = "") => `import { ensure } from "${INDEX}";
export const initial = { s: "a" };
export const actors = { p: {} };
${extra}
export function go(x: { s: string }) {
${evidence.map((e) => `  // 根拠: ${e}`).join("\n")}
  ensure(x.s === "a", "a のときだけ");
  return { s: "b" };
}
`;

const project = () => {
  const dir = mkdtempSync(join(tmpdir(), "live-spec-evidence-"));
  mkdirSync(join(dir, "specs"));
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src", "go.ts"), "line1\nline2\nline3\n");
  return dir;
};

describe("根拠の参照先を検査する", { timeout: 30_000 }, () => {
  it("参照先のファイルがあり、行がその範囲にあれば、検査結果に出さない", async () => {
    const dir = project();
    writeFileSync(join(dir, "specs", "go.spec.ts"), specSource(["src/go.ts:2", "src/go.ts:1-3", "src/go.ts handler（説明）"]));

    const { graph } = await loadObject(join(dir, "specs", "go.spec.ts"));

    expect(graph.findings.filter((f) => f.kind.startsWith("evidence-"))).toEqual([]);
  });

  it("参照先のファイルが無ければ、検査結果に出す", async () => {
    const dir = project();
    writeFileSync(join(dir, "specs", "go.spec.ts"), specSource(["src/moved.ts:2"]));

    const { graph } = await loadObject(join(dir, "specs", "go.spec.ts"));

    expect(graph.findings).toContainEqual({ kind: "evidence-missing", action: "go", evidence: "src/moved.ts:2" });
  });

  it("行がファイルの範囲の外にあれば、検査結果に出す", async () => {
    const dir = project();
    writeFileSync(join(dir, "specs", "go.spec.ts"), specSource(["src/go.ts:2-9"]));

    const { graph } = await loadObject(join(dir, "specs", "go.spec.ts"));

    expect(graph.findings).toContainEqual({ kind: "evidence-out-of-range", action: "go", evidence: "src/go.ts:2-9", lines: 3 });
  });

  it("1 行に「、」や「,」で並べた複数の場所を、それぞれ検査する。「:877-879」は直前と同じファイルとして読む", async () => {
    const dir = project();
    writeFileSync(join(dir, "src", "other.ts"), "a\nb\nc\nd\n");
    writeFileSync(
      join(dir, "specs", "go.spec.ts"),
      specSource([
        "src/go.ts:1-2、src/other.ts:4",
        "src/go.ts:1, src/other.ts:2-3",
        "src/other.ts:1、:3-4（a・b、c）",
        "src/go.ts:2（開始）、:9（再開）",
        "src/go.ts handler（server.listen(port, \"127.0.0.1\")、補足）",
      ]),
    );

    const { graph } = await loadObject(join(dir, "specs", "go.spec.ts"));

    expect(graph.findings.filter((f) => f.kind.startsWith("evidence-"))).toEqual([
      { kind: "evidence-out-of-range", action: "go", evidence: "src/go.ts:2（開始）、:9（再開）", lines: 3 },
    ]);
  });

  it("evidenceRoot を書くと、spec のファイルからの相対でそこを起点に探す", async () => {
    const dir = project();
    mkdirSync(join(dir, "app", "lib"), { recursive: true });
    writeFileSync(join(dir, "app", "lib", "run.ts"), "a\nb\n");
    writeFileSync(join(dir, "specs", "go.spec.ts"), specSource(["lib/run.ts:2"], 'export const evidenceRoot = "../app";'));

    const { graph } = await loadObject(join(dir, "specs", "go.spec.ts"));

    expect(graph.findings.filter((f) => f.kind.startsWith("evidence-"))).toEqual([]);
  });
});
