import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli.ts";
import { loadObject } from "../src/generate.ts";

const INDEX = new URL("../src/index.ts", import.meta.url).pathname;
const CODE = ["import a from 'a';", "export function start(job) {", "  if (job.status !== 'queued') throw new Error();", "  return run(job);", "}"].join("\n");

const specSource = (evidence: string) => `import { ensure } from "${INDEX}";
export const initial = { s: "a" };
export const actors = { p: {} };
export function go(x: { s: string }) {
  // 根拠: src/job.ts:${evidence}
  ensure(x.s === "a", "a のときだけ");
  return { s: "b" };
}
`;

const project = (evidence = "2-4") => {
  const dir = mkdtempSync(join(tmpdir(), "live-spec-lock-"));
  mkdirSync(join(dir, "specs"));
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src", "job.ts"), CODE);
  writeFileSync(join(dir, "specs", "go.spec.ts"), specSource(evidence));
  return { dir, spec: join(dir, "specs", "go.spec.ts"), code: join(dir, "src", "job.ts"), lock: join(dir, "specs", "live-spec.evidence.lock") };
};

const io = () => {
  const out: Array<string> = [];
  return { out, io: { stdout: (s: string) => out.push(s), stderr: (s: string) => out.push(s) } };
};
const lockFindings = async (spec: string) =>
  (await loadObject(spec)).graph.findings.filter((f) => ["evidence-moved", "evidence-changed", "evidence-unlocked"].includes(f.kind));

describe("根拠の lock: 根拠の範囲のコードが変わったことを知らせる", { timeout: 60_000 }, () => {
  it("lock が無い spec では照合しない", async () => {
    const p = project();

    expect(await lockFindings(p.spec)).toEqual([]);
  });

  it("evidence --update は、spec のディレクトリに、キーを並べて 1 行 1 件の lock を書く", async () => {
    const p = project();

    expect(await runCli(["evidence", "--update", p.spec], io().io)).toBe(0);

    const lines = readFileSync(p.lock, "utf8").trim().split("\n");
    expect(lines[0]).toBe("{");
    expect(lines[1]).toMatch(/^  "go go src\/job\.ts:2-4": "[0-9a-f]{16}"$/);
    expect(await lockFindings(p.spec)).toEqual([]);
  });

  it("空白やインデントだけの変更は、変わったことにしない", async () => {
    const p = project();
    await runCli(["evidence", "--update", p.spec], io().io);

    writeFileSync(p.code, CODE.replace("  if (job.status", "\tif   (job.status"));

    expect(await lockFindings(p.spec)).toEqual([]);
  });

  it("範囲の中身が変わったら「中身が変わった」と出す", async () => {
    const p = project();
    await runCli(["evidence", "--update", p.spec], io().io);

    writeFileSync(p.code, CODE.replace("'queued'", "'waiting'"));

    expect(await lockFindings(p.spec)).toEqual([{ kind: "evidence-changed", action: "go", evidence: "src/job.ts:2-4", location: "src/job.ts:2-4" }]);
  });

  it("同じ中身が別の行にあれば「行がずれた」と新しい行番号を出し、evidence --update が根拠のコメントの行番号を書き換える", async () => {
    const p = project();
    await runCli(["evidence", "--update", p.spec], io().io);
    writeFileSync(p.code, "import b from 'b';\nimport c from 'c';\n" + CODE);

    expect(await lockFindings(p.spec)).toEqual([
      { kind: "evidence-moved", action: "go", evidence: "src/job.ts:2-4", location: "src/job.ts:2-4", moved: "4-6" },
    ]);

    const t = io();
    expect(await runCli(["evidence", "--update", p.spec], t.io)).toBe(0);
    expect(readFileSync(p.spec, "utf8")).toContain("// 根拠: src/job.ts:4-6");
    expect(t.out.join("")).toContain("行がずれた根拠を直した: 1 件");
    expect(await lockFindings(p.spec)).toEqual([]);
  });

  it("lock に記録されていない根拠は「lock に無い」と出す", async () => {
    const p = project();
    await runCli(["evidence", "--update", p.spec], io().io);
    writeFileSync(p.spec, specSource("2-3"));

    expect(await lockFindings(p.spec)).toEqual([{ kind: "evidence-unlocked", action: "go", evidence: "src/job.ts:2-3", location: "src/job.ts:2-3" }]);
  });

  it("根拠の中身が変わったら、live-spec check は 1 で終わる", async () => {
    const p = project();
    await runCli(["evidence", "--update", p.spec], io().io);
    writeFileSync(p.code, CODE.replace("'queued'", "'waiting'"));

    const t = io();
    expect(await runCli(["check", p.spec, "--cwd", p.dir], t.io)).toBe(1);
    expect(t.out.join("")).toContain("根拠のコードの中身が変わった");
  });
});
