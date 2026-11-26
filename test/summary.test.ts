import { describe, expect, it } from "vitest";
import { explore } from "../src/explore.ts";
import { ensure } from "../src/index.ts";
import { loadSpec } from "../src/load.ts";
import { summarizeActions, summarizeStates } from "../src/render/summary.ts";
import { loadArticle } from "./fixtures/load-article.ts";

const spec = loadArticle();
const graph = explore(spec);

describe("summarizeActions: 操作ごとの要約", () => {
  it("担当者、ほかの人が止められた理由、できるとき、できないとき、結果をまとめる", () => {
    const publish = summarizeActions(spec, graph).find((a) => a.name === "publish")!;

    expect(publish).toEqual({
      name: "publish",
      summary: "公開する",
      capable: ["editor", "admin"],
      othersReasons: ["編集者か管理者だけ"],
      when: [{ from: "inReview", to: "published" }],
      blocked: [{ reason: "レビュー中のときだけ", states: ["draft", "published", "published · pinned", "archived"] }],
      effect: [{ field: "status", values: ["published"], partial: false }],
      inputReasons: [],
      inputOutcomes: [],
    });
  });
});

describe("summarizeStates: 状態ごとの要約", () => {
  it("その状態でできる操作と、できない操作の理由をまとめる", () => {
    const draft = summarizeStates(spec, graph).find((s) => s.label === "draft")!;

    expect(draft.can).toEqual([{ action: "submit", actors: ["alice"], to: "inReview" }]);
    expect(draft.cannot).toEqual([
      { action: "publish", reason: "レビュー中のときだけ" },
      { action: "pin", reason: "公開中のときだけ" },
      { action: "archive", reason: "公開中のときだけ" },
    ]);
  });

  it("誰も一度も実行できない操作は、全員が止められた理由を示す", () => {
    const never = loadSpec("never", {
      initial: { status: "a" },
      actors: { someone: {} },
      act: () => {
        ensure(false, "どんなときもできない");
        return {};
      },
    });

    expect(summarizeStates(never, explore(never))[0]!.cannot).toEqual([{ action: "act", reason: "どんなときもできない" }]);
  });
});
