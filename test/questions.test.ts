import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { explore } from "../src/explore.ts";
import { loadSpec } from "../src/load.ts";
import { renderIndexMarkdown, renderMarkdown } from "../src/render/markdown.ts";
import { renderProjectHtml } from "../src/render/html.ts";
import * as Article from "./fixtures/article.spec.ts";

const source = readFileSync(new URL("./fixtures/article.spec.ts", import.meta.url), "utf8");
const withQuestions = (questions: unknown) => loadSpec("article", { ...Article, questions }, { source });

const spec = withQuestions([
  { ask: "アーカイブした記事を戻せるようにするか？", about: Article.archive, note: "今は戻す操作がない" },
  { ask: "固定中の記事は何件まで？", about: { pinned: true } },
  { ask: "記事にタグを付けるか？" },
]);
const graph = explore(spec);
const labelOf = (id: string) => graph.states.find((s) => s.id === id)!.label;

describe("questions: 未決事項", { timeout: 30_000 }, () => {
  it("questions を読み、操作には含めない", () => {
    expect(spec.questions).toHaveLength(3);
    expect(spec.actions.map(([n]) => n)).not.toContain("questions");
  });

  it("操作についての質問は、その操作に結び付ける", () => {
    expect(graph.questions[0]).toEqual({ ask: "アーカイブした記事を戻せるようにするか？", note: "今は戻す操作がない", action: "archive", states: [] });
  });

  it("状態の一部で指定した質問は、当てはまるすべての状態に結び付ける", () => {
    expect(graph.questions[1]!.states.map(labelOf)).toEqual(["published · pinned"]);
  });

  it("対象を指定しない質問は、spec 全体についての質問にする", () => {
    expect(graph.questions[2]).toMatchObject({ action: null, states: [] });
  });

  it("状態の一部で指定したのに、どの状態にも当てはまらなければ検出する", () => {
    const s = withQuestions([{ ask: "削除した記事は？", about: { status: "deleted" } }]);

    expect(explore(s).findings).toContainEqual({ kind: "question-unmatched", ask: "削除した記事は？" });
  });

  it("Markdown では、説明のすぐ後に未決事項をまとめ、操作の節にも書く", () => {
    const md = renderMarkdown(spec, graph);

    expect(md.indexOf("## 未決事項")).toBeLessThan(md.indexOf("## 状態遷移図"));
    expect(md).toContain("1. アーカイブした記事を戻せるようにするか？（操作: アーカイブする）\n   - 今は戻す操作がない");
    expect(md).toContain("2. 固定中の記事は何件まで？（状態: published · pinned）");
    expect(md).toContain("- **未決**: アーカイブした記事を戻せるようにするか？");
  });

  it("Markdown の一覧に、ドメインオブジェクトごとの未決事項の数を出す", () => {
    expect(renderIndexMarkdown([{ spec, graph }], "blog")).toContain("| 3 |");
  });

  it("HTML では、未決事項の節と、図のノード・操作カードの印を出す", async () => {
    const html = await renderProjectHtml([{ spec, graph }], { title: "blog" });

    expect(html).toContain('<section class="questions"');
    expect(html).toMatch(/class="node[^"]*has-question[^"]*" data-state="[^"]+"/);
    expect(html).toMatch(/<article class="card[^"]*" data-action="archive"[\s\S]*?class="q-badge"/);
  });
});
