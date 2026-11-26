import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli.ts";

const INDEX = new URL("../src/index.ts", import.meta.url).pathname;
const REPO = new URL("..", import.meta.url).pathname;

const CLEAN = `import { ensure } from "${INDEX}";
export type Doc = { status: "draft" | "published" };
type User = { role: "author" | "editor" };
export const initial: Doc = { status: "draft" };
export const actors: Record<string, User> = { 著者: { role: "author" }, 編集者: { role: "editor" } };
export const questions = [{ ask: "公開を取り消せるか？" }];
export function publish(d: Doc, u: User): Doc {
  ensure(u.role === "editor", "編集者だけ");
  ensure(d.status === "draft", "下書きのときだけ");
  return { status: "published" };
}
export const scenarios = {
  著者は公開できない: [{ do: publish, by: "著者", denied: "編集者だけ" }],
  公開済みは公開し直せない: [
    { do: publish, by: "編集者" },
    { do: publish, by: "編集者", denied: "下書きのときだけ" },
  ],
};
`;

const write = (source: string) => {
  const dir = mkdtempSync(join(tmpdir(), "live-spec-check-"));
  writeFileSync(join(dir, "doc.spec.ts"), source);
  return join(dir, "doc.spec.ts");
};

const run = async (argv: Array<string>, cwd = REPO) => {
  const out: Array<string> = [];
  const err: Array<string> = [];
  const code = await runCli(["check", ...argv, "--cwd", cwd], { stdout: (s) => out.push(s), stderr: (s) => err.push(s) });
  return { code, out: out.join(""), err: err.join("") };
};

describe("live-spec check: 型チェックと検査を行い、問題があれば 0 以外で終わる", { timeout: 60_000 }, () => {
  it("型の誤りも検査結果も確かめてほしい点も無ければ、未決事項があっても 0 で終わる", async () => {
    const r = await run([write(CLEAN)]);

    expect(r.code).toBe(0);
    expect(r.out).toContain("✓ doc");
  });

  it("検査結果があれば、一覧を出して 1 で終わる", async () => {
    const r = await run([write(CLEAN.replace('"公開済みは公開し直せない"', '"x"').replace('{ do: publish, by: "著者", denied: "編集者だけ" }', '{ do: publish, by: "誰か" }'))]);

    expect(r.code).toBe(1);
    expect(r.out).toContain("✗ doc");
    expect(r.out).toContain("登場人物「誰か」は actors にない");
  });

  it("未確認の確かめてほしい点があれば、1 で終わる", async () => {
    const r = await run([write(CLEAN.replace(/export const scenarios = \{[\s\S]*?\n\};/, ""))]);

    expect(r.code).toBe(1);
    expect(r.out).toContain("unguarded:publish:編集者だけ");
  });

  it("未決事項が判断待ちにしている候補は、失敗に数えない", async () => {
    const source = CLEAN.replace(/export const scenarios = \{[\s\S]*?\n\};/, "").replace(
      'export const questions = [{ ask: "公開を取り消せるか？" }];',
      'export const questions = [{ ask: "誰が公開できるかは未定", about: publish }];',
    );

    const r = await run([write(source)]);

    expect(r.code).toBe(0);
    expect(r.out).toContain("✓ doc（判断待ち 2 件）");
  });

  it("型の誤りがあれば、1 で終わる", async () => {
    const r = await run([write(CLEAN.replace('return { status: "published" };', 'return { status: "公開" };'))]);

    expect(r.code).toBe(1);
    expect(r.out).toContain("型チェック");
    expect(r.out).toMatch(/error TS\d+/);
  });

  it("typescript が見つからなければ、そう出して型チェックだけ飛ばす", async () => {
    const r = await run([write(CLEAN)], mkdtempSync(join(tmpdir(), "live-spec-nots-")));

    expect(r.code).toBe(0);
    expect(r.err).toContain("typescript が見つからないので、型チェックを飛ばしました");
  });
});
