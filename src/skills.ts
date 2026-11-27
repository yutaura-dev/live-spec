import { cpSync, existsSync, mkdirSync, readdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// 配布物では skills/（skills-npm などの慣習の置き場所。ビルドで .claude/skills からコピーする）、
// このリポジトリで直接動かすときは原本の .claude/skills から読む。src/ からも dist/ からも 1 つ上がルート。
const candidates = ["../skills/", "../.claude/skills/"].map((p) => fileURLToPath(new URL(p, import.meta.url)));
const SKILLS_DIR = candidates.find((dir) => existsSync(dir)) ?? candidates[1]!;
/** 同梱している skill の置き場所 */
export const skillsDir = SKILLS_DIR;

export const bundledSkills = (): Array<string> =>
  readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(SKILLS_DIR, d.name, "SKILL.md")))
    .map((d) => d.name)
    .sort();

export interface InstallResult {
  readonly name: string;
  readonly status: "installed" | "updated" | "skipped" | "linked";
}

export const installSkills = (targetDir: string, options: { readonly force?: boolean } = {}): Array<InstallResult> =>
  bundledSkills().map((name) => {
    const dest = join(targetDir, name, "SKILL.md");
    const exists = existsSync(dest);
    // pnpm の permissions などで、置き場所がパッケージの中の skill への symlink になっていることがある。そのときは
    // コピー元とコピー先が同じファイルで、コピーすると失敗する。パッケージを上げれば skill も上がるので、何もしない。
    if (exists && realpathSync(dest) === realpathSync(join(SKILLS_DIR, name, "SKILL.md"))) return { name, status: "linked" };
    if (exists && options.force !== true) return { name, status: "skipped" };
    mkdirSync(join(targetDir, name), { recursive: true });
    cpSync(join(SKILLS_DIR, name, "SKILL.md"), dest);
    return { name, status: exists ? "updated" : "installed" };
  });
