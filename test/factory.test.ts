import { describe, expect, it } from "vitest";
import { ensure } from "../src/ensure.ts";
import { explore } from "../src/explore.ts";
import { loadObject } from "../src/generate.ts";
import { loadSpec } from "../src/load.ts";
import { renderHtml } from "../src/render/html.ts";
import { renderMarkdown } from "../src/render/markdown.ts";

const FIXTURE = new URL("./fixtures/factory.spec.ts", import.meta.url).pathname;

describe("作る操作（initial を関数で書く）", { timeout: 60_000 }, () => {
  it("作れた結果を初期状態にし、登場人物と入力の例ごとに作れたか・作れない理由を記録する", async () => {
    const { graph } = await loadObject(FIXTURE);
    const label = (id: string | null) => graph.states.find((s) => s.id === id)?.label ?? null;

    const outcomes = graph.creation!.outcomes.map((o) => [o.actor, o.input, o.enabled ? label(o.to) : o.reason]);

    expect(outcomes).toEqual([
      ["著者alice", "ニュース", "draft · news"],
      ["著者alice", "コラム", "draft · column"],
      ["著者alice", "題名が空", "題名が必要"],
      ["読者carol", "ニュース", "著者だけ"],
      ["読者carol", "コラム", "著者だけ"],
      ["読者carol", "題名が空", "著者だけ"],
    ]);
    expect(graph.states.filter((s) => s.initial).map((s) => s.label)).toEqual(["draft · news", "draft · column"]);
  });

  it("作る操作の入力の例（inputs.initial）は、存在しない操作への入力として扱わない", async () => {
    const { graph } = await loadObject(FIXTURE);

    expect(graph.findings).toEqual([]);
  });

  it("作る操作が書く項目は、操作が書き換える項目に数えない（種類は作ったときに決まる値のまま）", async () => {
    const { spec } = await loadObject(FIXTURE);

    expect(spec.stateType).toBe("Article");
    expect(spec.creationFields).toEqual(["kind"]);
    expect(spec.writtenFields).toEqual(["status", "featured"]);
  });

  it("シナリオは、最初の手順に作る操作を書いて始められる。作れないことも denied で書ける", async () => {
    const { graph } = await loadObject(FIXTURE);

    expect(graph.scenarios.map((s) => [s.name, s.passed, s.steps.map((st) => [st.action, st.ok, st.from])])).toEqual([
      ["書き始めて公開する", true, [["initial", true, null], ["publish", true, graph.states[0]!.id]]],
      ["読者は書き始められない", true, [["initial", true, null]]],
    ]);
  });

  it("作る操作の途中で ensure 以外の例外を投げたら、仕様のバグとして検査結果に出す", () => {
    const spec = loadSpec("broken", {
      actors: { 人a: { ok: true }, 人b: { ok: false } },
      initial: (actor: { ok: boolean }) => {
        if (!actor.ok) throw new TypeError("boom");
        return { status: "todo" };
      },
    });

    expect(explore(spec).findings).toEqual([{ kind: "creation-error", actor: "人b", input: null, message: "boom" }]);
  });

  it("誰も作れない spec は、読み込むときに理由を添えて断る", () => {
    const load = () =>
      loadSpec("nobody", {
        actors: { 人: {} },
        initial: () => {
          ensure(false, "だれも作れない");
          return { status: "todo" };
        },
      });

    expect(load).toThrow("nobody: どの登場人物・入力の例でも作れない（initial が「だれも作れない」で止まる）");
  });

  it("Markdown では、作る操作を操作の最初に、できる人と入力ごとの結果つきで出す", async () => {
    const { spec, graph } = await loadObject(FIXTURE);

    const md = renderMarkdown(spec, graph);

    expect(md).toContain(
      [
        "### 記事を書き始める（作る）",
        "",
        "- **できる人**: 著者alice（ほかの人は「著者だけ」）",
        "- **入力ごとの結果**:",
        "  - ニュース: → draft · news",
        "  - コラム: → draft · column",
        "  - 題名が空: ❌ 題名が必要",
        "- **関数名**: `initial`",
      ].join("\n"),
    );
    expect(md.indexOf("### 記事を書き始める（作る）")).toBeLessThan(md.indexOf("### 公開する"));
    expect(md).toContain("  [*] --> s0: 記事を書き始める (著者alice)");
  });

  it("Markdown のシナリオでは、作る手順を「作る前 → 状態」と書く", async () => {
    const { spec, graph } = await loadObject(FIXTURE);

    expect(renderMarkdown(spec, graph)).toContain("1. 著者alice が 記事を書き始める（initial、ニュース）: 作る前 → draft · news");
  });

  it("HTML では、作る操作を操作のカードの最初に出す", async () => {
    const { spec, graph } = await loadObject(FIXTURE);

    const html = await renderHtml(spec, graph);

    expect(html).toContain('<article class="card creation" data-action="initial"');
    expect(html).toMatch(/<ol class="storyboard">.*?作る前/s);
    expect(html.indexOf('<article class="card creation" data-action="initial"')).toBeLessThan(html.indexOf('<article class="card" data-action="publish"'));
  });
});
