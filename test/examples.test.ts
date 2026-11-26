import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { expandSpecPaths, generateProject } from "../src/cli.ts";
import { loadObject } from "../src/generate.ts";
import { renderMarkdown } from "../src/render/markdown.ts";
import { explore } from "../src/explore.ts";
import { loadSpec } from "../src/load.ts";
import * as JobApi from "../examples/job-api.spec.ts";
import * as Minimal from "../examples/minimal.spec.ts";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("examples: README に載せている例", () => {
  it("minimal.spec.ts は検査で問題が出ない", () => {
    const spec = loadSpec("minimal", Minimal, { source: source("../examples/minimal.spec.ts") });

    expect(explore(spec).findings).toEqual([]);
  });

  it("job-api.spec.ts（API の例）は検査で問題が出ない", () => {
    const spec = loadSpec("job-api", JobApi, { source: source("../examples/job-api.spec.ts") });

    expect(explore(spec).findings).toEqual([]);
  });

  it("このリポジトリ自身の仕様（specs/）は、どのドメインオブジェクトも検査で問題が出ない", async () => {
    const out = await generateProject(expandSpecPaths([new URL("../specs", import.meta.url).pathname]), "json");

    const models = out.kind === "text" ? (JSON.parse(out.content) as { objects: Array<{ name: string; findings: unknown[] }> }).objects : [];
    expect(models.map((m) => [m.name, m.findings])).toEqual([
      ["browser-tab", []],
      ["cli-invocation", []],
      ["local-server", []],
      ["watch-session", []],
    ]);
  });

  it("README には minimal.spec.ts と同じコードを載せている", () => {
    expect(source("../README.md")).toContain(source("../examples/minimal.spec.ts").trim());
  });

  it("README に載せている publish の節は、minimal.spec.ts から今生成される節と同じ", async () => {
    const { spec, graph } = await loadObject(new URL("../examples/minimal.spec.ts", import.meta.url).pathname);

    const md = renderMarkdown(spec, graph);
    const publish = md.slice(md.indexOf("### 公開する\n"), md.indexOf("\n## ", md.indexOf("### 公開する\n"))).trim();

    expect(source("../README.md")).toContain(`\`\`\`markdown\n${publish}\n\`\`\``);
  });
});
