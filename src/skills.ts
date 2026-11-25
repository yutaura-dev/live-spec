import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// 同梱の skill をパッケージのルートの .claude/skills から読む理由: このリポジトリで開発に使っている skill を
// そのまま配布物に入れ、原本を 1 か所に保つため（src/ からも dist/ からも 1 つ上がルート）。
const SKILLS_DIR = fileURLToPath(new URL("../.claude/skills/", import.meta.url));

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
