import { describe, expect, it } from "vitest";
import { explore } from "../src/explore.ts";
import { ensure } from "../src/index.ts";
import { loadSpec } from "../src/load.ts";
import { renderMarkdown } from "../src/render/markdown.ts";
import { loadArticle } from "./fixtures/load-article.ts";

const spec = loadArticle();
const doc = renderMarkdown(spec, explore(spec));
const section = (action: string) => doc.split(new RegExp(`### (?:.*（)?\`${action}\`）?\\n`))[1]!.split("\n### ")[0]!.split("\n## ")[0]!;

describe("renderMarkdown: 見出し", () => {
  it("状態の型の JSDoc を、仕様書の冒頭の説明にする", () => {
    expect(doc).toContain("# article\n\nブログ記事");
  });

  it("操作の見出しに、JSDoc の説明文と関数名を並べる", () => {
    expect(doc).toContain("### 公開する（`publish`）");
  });

  it("JSDoc がない操作は、関数名だけを見出しにする", () => {
    expect(doc).toContain("### `pin`");
  });
});

const loopSpec = () =>
  loadSpec("loop", {
    initial: { status: "a" },
    actors: { p: {} },
    touch: (d: { status: string }) => {
      ensure(d.status === "a", "a のときだけ");
      return d;
    },
    go: (d: { status: string }) => {
      ensure(d.status === "a", "a のときだけ");
      return { status: "b" };
    },
  });

describe("renderMarkdown: 状態遷移図", () => {
  it("自分自身に戻る遷移は図に描かない（線が図を埋めて読めなくなるので）", () => {
    const s = loopSpec();

    expect(renderMarkdown(s, explore(s))).not.toContain("s0 --> s0");
  });

  it("Mermaid の状態遷移図に、操作名と実行できた登場人物を載せる", () => {
    expect(doc).toContain("s0 --> s1: submit (alice)");
    expect(doc).toContain("s1 --> s2: publish (editor, admin)");
  });
});

describe("renderMarkdown: 操作ごとの節", () => {
  it("できる人と、ほかの人が止められた理由を示す", () => {
    expect(section("publish")).toContain("- **できる人**: editor, admin（ほかの人は「編集者か管理者だけ」）");
  });

  it("できる人の判定には、担当者以外が最初に止められた理由を使う", () => {
    expect(section("submit")).toContain("- **できる人**: alice（ほかの人は「自分の記事だけ」）");
  });

  it("できるときを、遷移の前後の状態で示す", () => {
    expect(section("publish")).toContain("- **できるとき**: inReview → published");
  });

  it("できないときは、担当者が止められた理由で状態をまとめる", () => {
    expect(section("publish")).toContain("- **できないとき**: それ以外のすべての状態（レビュー中のときだけ）");
  });

  it("できない理由が状態によって違うときは、理由ごとに行を分け、一番多いまとまりを『それ以外』にする", () => {
    expect(section("pin")).toContain(
      "- **できないとき**:\n  - published · pinned（まだ固定していないときだけ）\n  - それ以外のすべての状態（公開中のときだけ）",
    );
  });

  it("できないときの状態が少ないなら、『それ以外』にまとめずに並べる", () => {
    expect(section("submit")).toContain("- **できないとき**: それ以外のすべての状態（下書きのときだけ）");
    const small = loopSpec();
    const doc2 = renderMarkdown(small, explore(small));
    expect(doc2).toContain("- **できないとき**: b（a のときだけ）");
  });

  it("自分自身に戻る遷移は、できるときの一覧で『変わらない』と書く", () => {
    const s = loopSpec();

    expect(renderMarkdown(s, explore(s))).toContain("- **できるとき**: a（変わらない）");
  });

  it("結果は、遷移の前後で変わった項目で示す", () => {
    expect(section("pin")).toContain("- **結果**: pinned → true");
  });
});
