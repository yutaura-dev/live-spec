import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli.ts";
import { expandSpecPaths, expandValuePaths, generateProject } from "../src/generate.ts";
import { isSpecModuleUrl } from "../src/spec-loader.ts";
import { loadValueObject } from "../src/value-object.ts";

const INDEX = new URL("../src/index.ts", import.meta.url).pathname;

const PLACE = (extra = "") => `/** 作業する場所。画面から開ける */
export type Place = {
  /** 開く URL */
  url: string;
  /** 確かめたか */
  certainty: "confirmed" | "guessed";
};

export const invariants = {
  "URL は http か https で始まる": (p: Place) => /^https?:\\/\\//.test(p.url),
};

export const examples = {
  valid: { "社内の Wiki": { url: "https://wiki.example.com", certainty: "confirmed" } },
  invalid: {
    "URL が空": { url: "", certainty: "guessed" },
    ${extra}
  },
};
`;

const TASK = `import { ensure } from "${INDEX}";
import type { Place } from "./place.value.ts";
/** タスク */
export type Task = { status: "todo" | "done"; /** 作業する場所 */ place: Place | null };
export const initial: Task = { status: "todo", place: null };
export const actors = { 人: {} };
/** 終える */
export function complete(t: Task): Task { ensure(t.status === "todo", "todo のときだけ"); return { ...t, status: "done" }; }
`;

const project = (extra = "") => {
  const dir = mkdtempSync(join(tmpdir(), "live-spec-vo-"));
  mkdirSync(join(dir, "specs"));
  writeFileSync(join(dir, "specs", "task.spec.ts"), TASK);
  writeFileSync(join(dir, "specs", "place.value.ts"), PLACE(extra));
  return join(dir, "specs");
};

describe("値オブジェクト（*.value.ts）", { timeout: 60_000 }, () => {
  it("ディレクトリから、spec とは別に値オブジェクトのファイルを集め、TypeScript として読む", () => {
    const dir = project();

    expect(expandSpecPaths([dir]).map((p) => p.split("/").pop())).toEqual(["task.spec.ts"]);
    expect(expandValuePaths([dir]).map((p) => p.split("/").pop())).toEqual(["place.value.ts"]);
    expect(isSpecModuleUrl("file:///a/specs/place.value.ts")).toBe(true);
  });

  it("型・項目・決まりを読み、正しい例はすべての決まりを満たし、正しくない例はどれかを破ることを確かめる", async () => {
    const vo = await loadValueObject(join(project(), "place.value.ts"));

    expect(vo).toMatchObject({ name: "place", displayName: "Place", typeName: "Place", doc: "作業する場所。画面から開ける" });
    expect(vo.properties.map((p) => p.field)).toEqual(["url", "certainty"]);
    expect(vo.invariants).toEqual(["URL は http か https で始まる"]);
    expect(vo.examples).toEqual([
      { name: "社内の Wiki", valid: true, ok: true, broken: [] },
      { name: "URL が空", valid: false, ok: true, broken: ["URL は http か https で始まる"] },
    ]);
    expect(vo.findings).toEqual([]);
  });

  it("どの決まりも破らない正しくない例は、検査結果に出し、check を失敗させる", async () => {
    const dir = project('決まりを破らない: { url: "https://x.example.com", certainty: "guessed" },');
    const out: Array<string> = [];

    const vo = await loadValueObject(join(dir, "place.value.ts"));
    const code = await runCli(["check", dir], { stdout: (s) => out.push(s), stderr: (s) => out.push(s) });

    expect(vo.findings).toEqual(["正しくない例「決まりを破らない」が、どの決まりも破らない（決まりの書き漏れか、例の誤り）"]);
    expect(code).toBe(1);
    expect(out.join("")).toContain("✗ Place（値オブジェクト）");
  });

  it("一覧ページに値オブジェクトの節を出す（spec が 1 つでも）", async () => {
    const out = await generateProject(expandSpecPaths([project()]), "html", "仕様", [], expandValuePaths([project()]));

    const html = out.kind === "text" ? out.content : "";
    expect(html).toContain("<h2>値オブジェクト</h2>");
    expect(html).toContain('<h3 id="value-place">Place</h3>');
    expect(html).toContain("URL は http か https で始まる");
    expect(html).toContain("URL が空");
  });

  it("ドメインオブジェクトのプロパティの表で、値オブジェクトの型の項目を値オブジェクトの節へ結ぶ", async () => {
    const dir = project();

    const html = await generateProject(expandSpecPaths([dir]), "html", "仕様", [], expandValuePaths([dir]));
    const md = await generateProject(expandSpecPaths([dir]), "markdown", "仕様", [], expandValuePaths([dir]));

    expect(html.kind === "text" ? html.content : "").toContain('<a href="#/:value/place">値オブジェクト（Place）</a>');
    expect(md.kind === "files" ? md.files["task.md"] : "").toContain("[値オブジェクト（Place）](README.md#place)");
  });

  it("Markdown の一覧に値オブジェクトの節を出す", async () => {
    const dir = project();
    const out = await generateProject(expandSpecPaths([dir]), "markdown", "仕様", [], expandValuePaths([dir]));

    const readme = out.kind === "files" ? out.files["README.md"]! : "";
    expect(readme).toContain("## 値オブジェクト");
    expect(readme).toContain("### Place");
    expect(readme).toContain("| url | `string` | 開く URL |");
    expect(readme).toContain("- URL は http か https で始まる");
    expect(readme).toContain("| URL が空 | 正しくない | ✅ |");
  });
});
