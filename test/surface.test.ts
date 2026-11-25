import { describe, expect, it } from "vitest";
import { explore } from "../src/explore.ts";
import { api, cli, ui } from "../src/index.ts";
import { loadSpec } from "../src/load.ts";
import { renderHtml } from "../src/render/html.ts";
import { summarizeStates } from "../src/render/summary.ts";
import * as Fixture from "./fixtures/surface.spec.ts";

const spec = loadSpec("surface", Fixture);
const graph = explore(spec);
const draft = graph.states.find((s) => s.label === "draft")?.id ?? "s0";

describe("ui / api / cli: サーフェスを組み立てる", () => {
  it("ボタンに操作の関数を渡すと、操作名を参照する", () => {
    expect(ui.button("公開する", Fixture.publish)).toEqual({ kind: "button", label: "公開する", action: "publish" });
  });

  it("画面は見出しと子要素を持つ", () => {
    expect(ui.screen("記事", ui.text("本文"))).toEqual({ kind: "screen", title: "記事", children: [{ kind: "text", text: "本文" }] });
  });

  it("API の応答と CLI の出力は、コードブロックとして表す", () => {
    expect(api.response(200, { id: 1 })).toEqual({ kind: "code", language: "http", text: 'HTTP 200\n{\n  "id": 1\n}' });
    expect(cli.output("$ live-spec\nok")).toEqual({ kind: "code", language: "terminal", text: "$ live-spec\nok" });
  });
});

describe("explore: 状態 × 登場人物ごとにサーフェスを計算する", () => {
  it("surface 関数を読み、操作には含めない", () => {
    expect(spec.surface).toBeTypeOf("function");
    expect(spec.actions.map(([name]) => name)).toEqual(["publish"]);
  });

  it("すべての状態と登場人物について、見える画面を記録する", () => {
    expect(graph.surfaces).toHaveLength(graph.states.length * 2);
    expect(graph.surfaces.find((s) => s.state === draft && s.actor === "editor")!.surface).toEqual({
      kind: "screen",
      title: "記事",
      children: [
        { kind: "badge", text: "draft" },
        { kind: "button", label: "公開する", action: "publish" },
      ],
    });
  });

  it("押しても実行できないボタンが見えていたら検出する", () => {
    expect(graph.findings).toContainEqual({ kind: "surface-action-not-allowed", state: draft, actor: "viewer", action: "publish" });
    expect(graph.findings).not.toContainEqual(expect.objectContaining({ kind: "surface-action-not-allowed", actor: "editor" }));
  });

  it("disabled のボタンは、実行できなくても検出しない", () => {
    const s = loadSpec("x", {
      ...Fixture,
      surface: (doc: { status: string }, user: { role: string }) =>
        ui.screen("記事", ui.button("公開する", Fixture.publish, { disabled: user.role !== "editor" || doc.status !== "draft" })),
    });

    expect(explore(s).findings.filter((f) => f.kind.startsWith("surface-"))).toEqual([]);
  });

  it("実行できる操作に対応するボタンがなければ検出する", () => {
    const s = loadSpec("x", { ...Fixture, surface: () => ui.screen("記事") });

    expect(explore(s).findings).toContainEqual({ kind: "surface-action-missing", state: draft, actor: "editor", action: "publish" });
  });

  it("API や CLI の出力（ui.screen 以外）には、ボタンがないことを検査しない", () => {
    const s = loadSpec("x", { ...Fixture, surface: () => api.response(200, { ok: true }) });

    expect(explore(s).findings.filter((f) => f.kind === "surface-action-missing")).toEqual([]);
  });

  it("surface が null を返した登場人物には、画面がないものとして記録も検査もしない", () => {
    const s = loadSpec("x", {
      ...Fixture,
      surface: (_doc: unknown, user: { role: string }) => (user.role === "viewer" ? null : ui.screen("記事")),
    });
    const g = explore(s);

    expect(g.surfaces.some((x) => x.actor === "viewer")).toBe(false);
    expect(g.findings.filter((f) => f.kind.startsWith("surface-") && "actor" in f && f.actor === "viewer")).toEqual([]);
  });

  it("surface 関数が例外を投げたら検出する", () => {
    const s = loadSpec("x", {
      ...Fixture,
      surface: () => {
        throw new Error("boom");
      },
    });

    expect(explore(s).findings).toContainEqual(expect.objectContaining({ kind: "surface-error", message: "boom" }));
  });

  it("surface がない spec ではサーフェスを記録しない", () => {
    const { surface: _omit, ...rest } = Fixture;
    expect(explore(loadSpec("x", rest)).surfaces).toEqual([]);
  });
});

describe("仕様書での表示", { timeout: 30_000 }, () => {
  it("状態ごとに、同じ画面を見る登場人物をまとめる", () => {
    const published = summarizeStates(spec, graph).find((s) => s.label === "published")!;

    expect(published.surfaces).toEqual([
      {
        actors: ["editor", "viewer"],
        surface: { kind: "screen", title: "記事", children: [{ kind: "badge", text: "published" }, { kind: "text", text: "公開済みです" }] },
      },
    ]);
  });

  it("HTML にワイヤーフレームの描画用のスタイルを入れる", async () => {
    expect(await renderHtml(spec, graph)).toContain(".wf-screen");
  });
});
