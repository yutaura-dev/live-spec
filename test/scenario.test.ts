import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { explore } from "../src/explore.ts";
import { loadSpec } from "../src/load.ts";
import { renderHtml } from "../src/render/html.ts";
import { renderMarkdown } from "../src/render/markdown.ts";
import * as Fixture from "./fixtures/scenario.spec.ts";

const spec = loadSpec("doc", Fixture, { source: readFileSync(new URL("./fixtures/scenario.spec.ts", import.meta.url), "utf8") });
const graph = explore(spec);
const label = (id: string | null) => graph.states.find((s) => s.id === id)?.label ?? null;

describe("scenarios: 名前付きの手順を実行する", { timeout: 30_000 }, () => {
  it("scenarios を読み、操作には含めない", () => {
    expect(spec.scenarios.map(([name]) => name)).toEqual(["書いて公開するまで", "差し戻されて出し直す"]);
    expect(spec.actions.map(([name]) => name)).not.toContain("scenarios");
  });

  it("初期状態から手順どおりに実行し、各段階の前後の状態を記録する", () => {
    const s = graph.scenarios.find((x) => x.name === "書いて公開するまで")!;

    expect(s.passed).toBe(true);
    expect(s.steps.map((st) => [st.action, st.actor, label(st.from), label(st.to)])).toEqual([
      ["submit", "author", "draft", "inReview"],
      ["publish", "editor", "inReview", "published"],
    ]);
  });

  it("入力の例の名前を指定して、3 つ目以降の引数を渡す", () => {
    const s = graph.scenarios.find((x) => x.name === "差し戻されて出し直す")!;

    expect(s.passed).toBe(true);
    expect(s.steps[1]).toMatchObject({ action: "reject", input: "理由あり" });
  });

  it("途中で ensure に止められたら、そこで失敗として検出する", () => {
    const s = loadSpec("doc", { ...Fixture, scenarios: { いきなり公開: [{ do: Fixture.publish, by: "editor" }] } });

    const g = explore(s);

    expect(g.scenarios[0]).toMatchObject({ passed: false });
    expect(g.findings).toContainEqual({ kind: "scenario-failed", scenario: "いきなり公開", step: 1, reason: "レビュー中のときだけ" });
  });

  it("期待した状態と違えば、失敗として検出する", () => {
    const s = loadSpec("doc", {
      ...Fixture,
      scenarios: { 提出だけ: [{ do: Fixture.submit, by: "author", expect: { status: "published" } }] },
    });

    expect(explore(s).findings).toContainEqual({
      kind: "scenario-failed",
      scenario: "提出だけ",
      step: 1,
      reason: "期待: status = published、実際: status = inReview",
    });
  });

  it("存在しない登場人物や入力の例を指定したら、失敗として検出する", () => {
    const s = loadSpec("doc", {
      ...Fixture,
      scenarios: { 誤記: [{ do: Fixture.submit, by: "authr" }] },
    });

    expect(explore(s).findings).toContainEqual(expect.objectContaining({ kind: "scenario-failed", scenario: "誤記", step: 1 }));
  });
});

describe("シナリオを仕様書に出す", { timeout: 30_000 }, () => {
  it("Markdown に、シナリオごとの手順と結果を書く", () => {
    const md = renderMarkdown(spec, graph);

    expect(md).toContain("## シナリオ");
    expect(md).toContain("### ✅ 書いて公開するまで");
    expect(md).toContain("1. author が レビューに出す（submit）: draft → inReview");
  });

  it("手順の文では、操作の説明の末尾の「。」を外す", () => {
    const s = loadSpec("doc", Fixture, { source: "/** レビューに出す。 */\nexport function submit() {}" });

    expect(renderMarkdown(s, explore(s))).toContain("1. author が レビューに出す（submit）");
  });

  it("HTML に、シナリオのカードと、各段階の経路を入れる", async () => {
    const html = await renderHtml(spec, graph);

    expect(html).toContain('data-scenario="書いて公開するまで"');
  });
});
