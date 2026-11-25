// 配布物のルートの skills/<名前>/SKILL.md に skill を置く理由: skills-npm や skills CLI（experimental_sync）は、
// npm パッケージの skills/ を探して利用者の .claude/skills などへ自動でリンクする（install 時に「いい感じに」入る）。
// 原本はこのリポジトリで開発に使っている .claude/skills に 1 つだけ置き、配布の直前にコピーする。
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const from = ".claude/skills";
const to = process.argv[2] ?? "skills";
rmSync(to, { recursive: true, force: true });
for (const name of readdirSync(from)) {
  const skill = join(from, name, "SKILL.md");
  if (!existsSync(skill)) continue;
  mkdirSync(join(to, name), { recursive: true });
  cpSync(skill, join(to, name, "SKILL.md"));
}

// Claude Code の plugin の manifest も作る理由: パッケージのルートに .claude-plugin/plugin.json と skills/ があれば、
// marketplace の npm source から plugin としても入れられる（Claude Code の公式の配布経路）。
// 版数を package.json と食い違わせないため、手で書かずにビルドのたびに作る。
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
mkdirSync(".claude-plugin", { recursive: true });
writeFileSync(
  ".claude-plugin/plugin.json",
  JSON.stringify({ name: "live-spec", version: pkg.version, description: pkg.description, keywords: pkg.keywords }, null, 2) + "\n",
);
