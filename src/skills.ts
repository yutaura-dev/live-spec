import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// 配布物では skills/（skills-npm などの慣習の置き場所。ビルドで .claude/skills からコピーする）、
// このリポジトリで直接動かすときは原本の .claude/skills から読む。src/ からも dist/ からも 1 つ上がルート。
const candidates = ["../skills/", "../.claude/skills/"].map((p) => fileURLToPath(new URL(p, import.meta.url)));
const SKILLS_DIR = candidates.find((dir) => existsSync(dir)) ?? candidates[1]!;

export const bundledSkills = (): Array<string> =>
  readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(SKILLS_DIR, d.name, "SKILL.md")))
    .map((d) => d.name)
    .sort();

export interface InstallResult {
  readonly name: string;
  readonly status: "installed" | "updated" | "skipped";
}

export const installSkills = (targetDir: string, options: { readonly force?: boolean } = {}): Array<InstallResult> =>
  bundledSkills().map((name) => {
    const dest = join(targetDir, name, "SKILL.md");
    const exists = existsSync(dest);
    if (exists && options.force !== true) return { name, status: "skipped" };
    mkdirSync(join(targetDir, name), { recursive: true });
    cpSync(join(SKILLS_DIR, name, "SKILL.md"), dest);
    return { name, status: exists ? "updated" : "installed" };
  });
