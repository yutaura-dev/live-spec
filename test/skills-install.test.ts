import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli.ts";
import { bundledSkills, installSkills } from "../src/skills.ts";

describe("skills: 同梱した skill を対象のリポジトリに入れる", () => {
  it("同梱している skill の一覧を返す", () => {
    expect(bundledSkills()).toEqual(["live-spec-authoring", "live-spec-from-code", "live-spec-review"]);
  });

  it("指定したディレクトリに、skill ごとの SKILL.md をコピーする", () => {
    const dir = join(mkdtempSync(join(tmpdir(), "live-spec-skills-")), ".claude", "skills");

    const result = installSkills(dir);

    expect(result.map((r) => r.status)).toEqual(["installed", "installed", "installed"]);
    expect(readFileSync(join(dir, "live-spec-authoring", "SKILL.md"), "utf8")).toContain("name: live-spec-authoring");
  });

  it("すでにある skill は上書きせずに飛ばす（手を入れているかもしれないので）", () => {
    const dir = mkdtempSync(join(tmpdir(), "live-spec-skills-"));
    mkdirSync(join(dir, "live-spec-review"));
    writeFileSync(join(dir, "live-spec-review", "SKILL.md"), "自分で直した");

    const result = installSkills(dir);

    expect(result.find((r) => r.name === "live-spec-review")!.status).toBe("skipped");
    expect(readFileSync(join(dir, "live-spec-review", "SKILL.md"), "utf8")).toBe("自分で直した");
  });

  it("force なら上書きする", () => {
    const dir = mkdtempSync(join(tmpdir(), "live-spec-skills-"));
    mkdirSync(join(dir, "live-spec-review"));
    writeFileSync(join(dir, "live-spec-review", "SKILL.md"), "古い");

    installSkills(dir, { force: true });

    expect(readFileSync(join(dir, "live-spec-review", "SKILL.md"), "utf8")).toContain("name: live-spec-review");
  });

  it("live-spec skills install --dir で入れ、結果を一覧で出す", async () => {
    const dir = mkdtempSync(join(tmpdir(), "live-spec-skills-"));
    const out: Array<string> = [];

    const code = await runCli(["skills", "install", "--dir", dir], { stdout: (s) => out.push(s), stderr: (s) => out.push(s) });

    expect(code).toBe(0);
    expect(out.join("")).toContain("live-spec-from-code");
  });
});
