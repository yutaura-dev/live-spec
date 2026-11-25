import { describe, expect, it } from "vitest";
import { diffModels, renderDiff } from "../.claude/skills/live-spec-review/scripts/diff-model.mjs";

const model = (overrides: Record<string, unknown> = {}) => ({
  name: "doc",
  states: [
    { id: "s0", label: "draft" },
    { id: "s1", label: "published" },
  ],
  transitions: [{ from: "s0", to: "s1", action: "publish", actors: ["editor"] }],
  availability: [
    { state: "s0", action: "publish", actor: "editor", input: null, enabled: true, to: "s1", reason: null },
    { state: "s0", action: "publish", actor: "viewer", input: null, enabled: false, to: null, reason: "編集者だけ" },
  ],
  actions: [{ name: "publish" }],
  findings: [],
  surfaces: [],
  ...overrides,
});

describe("diffModels: 2 つの正規化モデルの振る舞いの違いを求める", () => {
  it("状態の増減を、ID ではなくラベルで比べる", () => {
    const after = model({
      states: [
        { id: "s0", label: "draft" },
        { id: "s1", label: "inReview" },
        { id: "s2", label: "published" },
      ],
    });

    const d = diffModels(model(), after);

    expect(d.states).toEqual({ added: ["inReview"], removed: [] });
  });

  it("遷移の増減を『前の状態 -操作-> 次の状態』で比べる", () => {
    const after = model({
      states: [
        { id: "s0", label: "draft" },
        { id: "s1", label: "inReview" },
        { id: "s2", label: "published" },
      ],
      transitions: [
        { from: "s0", to: "s1", action: "submit", actors: ["author"] },
        { from: "s1", to: "s2", action: "publish", actors: ["editor"] },
      ],
    });

    const d = diffModels(model(), after);

    expect(d.transitions.added).toEqual(["draft -submit-> inReview", "inReview -publish-> published"]);
    expect(d.transitions.removed).toEqual(["draft -publish-> published"]);
  });

  it("同じ状態・操作・登場人物で、できる／できない理由が変わったものを挙げる", () => {
    const after = model({
      availability: [
        { state: "s0", action: "publish", actor: "editor", input: null, enabled: true, to: "s1", reason: null },
        { state: "s0", action: "publish", actor: "viewer", input: null, enabled: true, to: "s1", reason: null },
      ],
    });

    const d = diffModels(model(), after);

    expect(d.availability).toEqual([
      { state: "draft", action: "publish", actor: "viewer", input: null, before: "❌ 編集者だけ", after: "✅ → published" },
    ]);
  });

  it("操作の増減を挙げる", () => {
    const after = model({ actions: [{ name: "publish" }, { name: "cancel" }] });

    expect(diffModels(model({ actions: [{ name: "publish" }] }), after).actions).toEqual({ added: ["cancel"], removed: [] });
  });

  it("検査結果の増減を挙げる", () => {
    const after = model({ findings: [{ kind: "never-enabled-action", action: "archive" }] });

    const d = diffModels(model(), after);

    expect(d.findings.added).toEqual([{ kind: "never-enabled-action", action: "archive" }]);
  });

  it("画面が変わった状態と登場人物を挙げる", () => {
    const before = model({ surfaces: [{ state: "s0", actor: "editor", surface: { kind: "screen", title: "A", children: [] } }] });
    const after = model({ surfaces: [{ state: "s0", actor: "editor", surface: { kind: "screen", title: "B", children: [] } }] });

    expect(diffModels(before, after).surfaces).toEqual([{ state: "draft", actor: "editor" }]);
  });
});

describe("diffModels: まとめた形式（cases）の正規化モデルも比べられる", () => {
  const compact = (viewerCases: unknown) => ({
    ...model(),
    actors: [{ name: "editor" }, { name: "viewer" }],
    inputs: {},
    availability: [
      {
        state: "s0",
        action: "publish",
        outcomes: viewerCases,
      },
    ],
  });

  it("* を全員に展開して、できる／できないの変化を求める", () => {
    const before = compact([{ enabled: false, to: null, reason: "編集者だけ", cases: "*" }]);
    const after = compact([
      { enabled: true, to: "s1", reason: null, cases: { editor: "*" } },
      { enabled: false, to: null, reason: "編集者だけ", cases: { viewer: "*" } },
    ]);

    expect(diffModels(before, after).availability).toEqual([
      { state: "draft", action: "publish", actor: "editor", input: null, before: "❌ 編集者だけ", after: "✅ → published" },
    ]);
  });
});

describe("renderDiff: 差分を Markdown にする", () => {
  it("変化がなければ、その旨だけを書く", () => {
    expect(renderDiff(diffModels(model(), model()))).toContain("振る舞いの変化はありません");
  });

  it("できる／できないの変化を表にする", () => {
    const after = model({
      availability: [
        { state: "s0", action: "publish", actor: "editor", input: null, enabled: true, to: "s1", reason: null },
        { state: "s0", action: "publish", actor: "viewer", input: null, enabled: true, to: "s1", reason: null },
      ],
    });

    expect(renderDiff(diffModels(model(), after))).toContain("| draft | publish | viewer | ❌ 編集者だけ | ✅ → published |");
  });
});
