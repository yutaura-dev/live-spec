import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const CLI = new URL("../src/cli.ts", import.meta.url).pathname;
const INDEX = new URL("../src/index.ts", import.meta.url).pathname;

describe("package.json に type がないプロジェクトでも、spec を読むときに Node の警告を出さない", { timeout: 30_000 }, () => {
  it("spec ごとの MODULE_TYPELESS_PACKAGE_JSON の警告が出ない", () => {
    const dir = mkdtempSync(join(tmpdir(), "live-spec-typeless-"));
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "workspace-root", private: true }));
    mkdirSync(join(dir, "specs"));
    writeFileSync(
      join(dir, "specs", "run.spec.ts"),
      `import { ensure } from "${INDEX}";
export const initial = { status: "queued" };
export const actors = { w: {} };
export function start(r: { status: string }) {
  ensure(r.status === "queued", "待機中のときだけ");
  return { status: "running" };
}
`,
    );

    const result = spawnSync(process.execPath, [CLI, join(dir, "specs", "run.spec.ts")], { cwd: dir, encoding: "utf8" });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("# Run");
    expect(result.stderr).not.toContain("MODULE_TYPELESS_PACKAGE_JSON");
  });
});
