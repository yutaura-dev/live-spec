import { describe, expect, it } from "vitest";
import { ensure } from "../src/index.ts";
import { explore } from "../src/explore.ts";
import { loadSpec } from "../src/load.ts";
import { loadArticle } from "./fixtures/load-article.ts";

const graph = explore(loadArticle());
const labelOf = (id: string) => graph.states.find((s) => s.id === id)!.label;
const stateId = (label: string) => graph.states.find((s) => s.label === label)!.id;

describe("explore: 関数を実行して状態遷移を計算する", () => {
  it("初期値から到達できる状態だけを列挙し、状態ごとに値が変わる項目でラベルを付ける", () => {
    expect(graph.states.map((s) => s.label)).toEqual(["draft", "inReview", "published", "published · pinned", "archived"]);
  });

  it("遷移には、それを実行できた登場人物が付く", () => {
    const edges = graph.transitions.map((t) => `${labelOf(t.from)} -${t.action}(${t.actors.join(",")})-> ${labelOf(t.to)}`);

    expect(edges).toEqual([
      "draft -submit(alice)-> inReview",
      "inReview -publish(editor,admin)-> published",
      "published -pin(editor)-> published · pinned",
      "published -archive(admin)-> archived",
      "published · pinned -archive(admin)-> archived",
    ]);
  });

  it("できなかった組み合わせには、最初に満たせなかった ensure の理由が付く", () => {
    const cell = (actor: string) =>
      graph.availability.find((a) => a.state === stateId("draft") && a.action === "submit" && a.actor === actor);

    expect(cell("bob")).toMatchObject({ enabled: false, reason: "自分の記事だけ" });
    expect(cell("alice")).toMatchObject({ enabled: true, reason: null });
  });

  it("誰も何もできない状態は終端になる", () => {
    expect(graph.states.filter((s) => s.terminal).map((s) => s.label)).toEqual(["archived"]);
  });
});

describe("explore: 検査結果", () => {
  it("どの状態でも誰も実行できない操作を検出する", () => {
    const g = explore(
      loadSpec("doc", {
        initial: { status: "draft" },
        actors: { admin: { role: "admin" } },
        restore: (doc: { status: string }) => {
          ensure(doc.status === "deleted", "削除済みのときだけ");
          return doc;
        },
      }),
    );

    expect(g.findings).toEqual([{ kind: "never-enabled-action", action: "restore" }]);
  });

  it("ensure 以外の例外は、できない理由ではなく仕様のバグとして検出する", () => {
    const g = explore(
      loadSpec("doc", {
        initial: { status: "draft" },
        actors: { admin: { role: "admin" } },
        broken: (doc: { tags?: Array<string> }) => ({ ...doc, first: doc.tags![0] }),
      }),
    );

    expect(g.findings).toContainEqual(expect.objectContaining({ kind: "action-error", action: "broken", actor: "admin" }));
    expect(g.availability[0]).toMatchObject({ enabled: false, reason: null });
  });

  it("型に書かれているのに、どの状態でもとらない値を検出する", () => {
    const source = [
      'type Doc = { status: "draft" | "published" | "deleted" };',
      'export const initial: Doc = { status: "draft" };',
      'export function publish(d: Doc) { ensure(d.status === "draft", "下書きのときだけ"); return { status: "published" }; }',
    ].join("\n");
    const g = explore(
      loadSpec(
        "doc",
        {
          initial: { status: "draft" },
          actors: { admin: {} },
          publish: (d: { status: string }) => {
            ensure(d.status === "draft", "下書きのときだけ");
            return { status: "published" };
          },
        },
        { source },
      ),
    );

    expect(g.findings).toEqual([{ kind: "unreachable-value", field: "status", value: "deleted" }]);
  });

  it("状態が増え続ける仕様は、上限で探索を打ち切って検出する", () => {
    const g = explore(
      loadSpec("counter", {
        initial: { count: 0 },
        actors: { anyone: {} },
        increment: (c: { count: number }) => ({ count: c.count + 1 }),
      }),
      { maxStates: 10 },
    );

    expect(g.states).toHaveLength(10);
    expect(g.findings).toContainEqual({ kind: "state-limit", maxStates: 10 });
  });
});
