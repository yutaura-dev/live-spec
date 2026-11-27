import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli.ts";
import { describeError, SpecError, stackOf } from "../src/errors.ts";
import { renderErrorHtml } from "../src/render/html.ts";

describe("エラーの出し方", () => {
  it("予期しない例外は、メッセージに続けてスタックトレースを出す", () => {
    const text = describeError(new TypeError("Cannot read properties of null (reading 'a')"));

    expect(text.split("\n")[0]).toBe("TypeError: Cannot read properties of null (reading 'a')");
    expect(text).toMatch(/\n\s+at /);
  });

  it("cause があれば、cause のスタックトレースも続けて出す", () => {
    const text = describeError(new Error("外側", { cause: new RangeError("内側") }));

    expect(text).toContain("原因: RangeError: 内側");
    expect(text.match(/\n\s+at /g)!.length).toBeGreaterThan(1);
  });

  it("spec の書き方の誤りのような予期した失敗は、メッセージだけを出す", () => {
    expect(describeError(new SpecError("task: 登場人物を表す export const actors が必要です"))).toBe("task: 登場人物を表す export const actors が必要です");
    expect(stackOf(new SpecError("x"))).toBeNull();
  });

  it("生成に失敗した spec では、スタックトレースを標準エラーに出す", async () => {
    const dir = mkdtempSync(join(tmpdir(), "live-spec-err-"));
    const path = join(dir, "boom.spec.ts");
    writeFileSync(path, 'export const initial = { s: "a" };\nexport const actors = { 人: {} };\nthrow new TypeError("spec を読み込む途中で落ちた");\n');
    const err: Array<string> = [];

    const code = await runCli([path], { stdout: () => {}, stderr: (s) => err.push(s) });

    expect(code).toBe(1);
    expect(err.join("")).toContain("生成に失敗しました: TypeError: spec を読み込む途中で落ちた");
    expect(err.join("")).toMatch(/\n\s+at /);
  });

  it("ブラウザのエラーページでは、スタックトレースを折りたたんで出す", () => {
    const html = renderErrorHtml("boom", new TypeError("落ちた"));

    expect(html).toContain("<pre>TypeError: 落ちた</pre>");
    expect(html).toContain("<details class=\"stack\"><summary>スタックトレース</summary><pre>");
  });
});
