import { describe, expect, it } from "vitest";
import { explore } from "../src/explore.ts";
import { loadSpec } from "../src/load.ts";
import { renderMarkdown } from "../src/render/markdown.ts";
import { summarizeActions } from "../src/render/summary.ts";
import * as Review from "./fixtures/review.spec.ts";

const spec = loadSpec("review", Review);
const graph = explore(spec);
const inReview = graph.states.find((s) => s.label === "inReview")!.id;

describe("inputs: 3 つ目以降の引数に例を与えて探索する", () => {
  it("入力の例ごとに操作を実行し、結果を入力の名前つきで記録する", () => {
    const cell = (input: string) =>
      graph.availability.find((a) => a.state === inReview && a.action === "reject" && a.actor === "editor" && a.input === input);

    expect(cell("理由あり")).toMatchObject({ enabled: true });
    expect(cell("理由なし")).toMatchObject({ enabled: false, reason: "差し戻し理由が必要" });
  });

  it("追加の引数をとらない操作は、入力なしとして記録する", () => {
    const a = graph.availability.find((x) => x.state === inReview && x.action === "publish" && x.actor === "editor");

    expect(a).toMatchObject({ enabled: true, input: null });
  });

  it("3 つ以上の引数をとるのに inputs がない操作は、実行せずに検出する", () => {
    const s = loadSpec("x", { ...Review, inputs: {} });

    const g = explore(s);

    expect(g.findings).toContainEqual({ kind: "missing-inputs", action: "reject" });
    expect(g.availability.some((a) => a.action === "reject")).toBe(false);
  });

  it("存在しない操作に対する inputs を検出する", () => {
    const s = loadSpec("x", { ...Review, inputs: { ...Review.inputs, typo: { 例: [] } } });

    expect(explore(s).findings).toContainEqual({ kind: "unknown-inputs", action: "typo" });
  });
});

describe("inputs: 仕様書での表示", () => {
  it("担当者が同じ状態で、入力によってだけ失敗する理由を『できない入力』としてまとめる", () => {
    const reject = summarizeActions(spec, graph).find((a) => a.name === "reject")!;

    expect(reject.capable).toEqual(["editor"]);
    expect(reject.inputReasons).toEqual([{ input: "理由なし", reason: "差し戻し理由が必要" }]);
  });

  it("入力ごとに、どの状態からどの状態へ移るか、またはなぜできないかをまとめる", () => {
    const reject = summarizeActions(spec, graph).find((a) => a.name === "reject")!;

    expect(reject.inputOutcomes).toEqual([
      { input: "理由あり", transitions: [{ from: "inReview", to: "draft" }], reasons: [] },
      { input: "理由なし", transitions: [], reasons: ["差し戻し理由が必要"] },
    ]);
  });

  it("Markdown の操作の節に、入力ごとの結果を書く", () => {
    expect(renderMarkdown(spec, graph)).toContain(
      "- **入力ごとの結果**:\n  - 理由あり: inReview → draft\n  - 理由なし: ❌ 差し戻し理由が必要",
    );
  });

  it("入力をとらない操作には、入力ごとの結果を書かない", () => {
    const publish = summarizeActions(spec, graph).find((a) => a.name === "publish")!;

    expect(publish.inputOutcomes).toEqual([]);
  });
});
