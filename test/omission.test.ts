import { describe, expect, it } from "vitest";
import { ensure } from "../src/ensure.ts";
import { explore } from "../src/explore.ts";
import { loadSpec } from "../src/load.ts";
import { findOmissionHints } from "../src/omission.ts";

type Doc = { status: "draft" | "published"; authorId: string; flagged: boolean };
type User = { id: string; role: "author" | "editor" };

const actors = {
  著者alice: { id: "alice", role: "author" },
  別の著者bob: { id: "bob", role: "author" },
  編集者eve: { id: "eve", role: "editor" },
};
const initial: Doc = { status: "draft", authorId: "alice", flagged: false };

const edit = (d: Doc, u: User): Doc => {
  ensure(u.id === d.authorId, "自分の文書だけ");
  ensure(d.status === "draft", "下書きのときだけ");
  return { ...d, flagged: !d.flagged };
};
const publish = (d: Doc, u: User): Doc => {
  ensure(u.role === "editor", "編集者だけ");
  ensure(d.status === "draft", "下書きのときだけ");
  return { ...d, status: "published" };
};
const withdraw = (d: Doc, u: User): Doc => {
  ensure(u.id === d.authorId, "自分の文書だけ");
  ensure(d.status === "published", "公開中のときだけ");
  return { ...d, status: "draft" };
};
const reject = (d: Doc, u: User, comment: string): Doc => {
  ensure(u.role === "editor", "編集者だけ");
  ensure(d.status === "published", "公開中のときだけ");
  ensure(comment.trim() !== "", "理由が必要");
  return { ...d, status: "draft" };
};

const hintsOf = (mod: Record<string, unknown>, bypass?: { action: string; reason: string }) => {
  const spec = loadSpec("doc", { initial, actors, inputs: { reject: { 理由あり: ["誤字"], 理由が空: [""] } }, ...mod });
  return findOmissionHints(spec, explore(spec, bypass === undefined ? {} : { bypassEnsure: bypass }), bypass === undefined ? {} : { bypassEnsure: bypass });
};
const kindsFor = (hints: ReturnType<typeof hintsOf>, action: string) => hints.filter((h) => h.action === action).map((h) => h.kind);

describe("漏れの候補: spec を実行した結果から、書き忘れていそうな条件を見つける", () => {
  it("条件がそろっている spec では、操作についての候補を出さない", () => {
    const hints = hintsOf({ edit, publish, withdraw, reject });

    expect(hints.filter((h) => h.action !== null)).toEqual([]);
  });

  it("「〜だけ」を書き忘れた操作は「誰でもできる」", () => {
    const hints = hintsOf({ edit, publish, withdraw, reject }, { action: "publish", reason: "編集者だけ" });

    expect(kindsFor(hints, "publish")).toContain("anyone-can");
  });

  it("状態の条件を書き忘れた操作は「いつでもできる」", () => {
    const hints = hintsOf({ edit, publish, withdraw, reject }, { action: "publish", reason: "下書きのときだけ" });

    expect(kindsFor(hints, "publish")).toContain("anytime");
  });

  it("入力の検証を書き忘れた操作は「入力を見ていない」", () => {
    const hints = hintsOf({ edit, publish, withdraw, reject }, { action: "reject", reason: "理由が必要" });

    expect(kindsFor(hints, "reject")).toContain("ignores-input");
  });

  it("「自分の〜だけ」を書き忘れた操作は、ほかの操作が区別している本人と別人を区別しない", () => {
    const hints = hintsOf({ edit, publish, withdraw, reject }, { action: "withdraw", reason: "自分の文書だけ" });

    const h = hints.find((x) => x.action === "withdraw" && x.kind === "same-for-similar-actors");
    expect(h).toBeDefined();
    expect(h!.message).toContain("著者alice");
    expect(h!.message).toContain("別の著者bob");
  });

  it("本人と別人を区別しない組が複数あっても、操作ごとに 1 件にまとめる", () => {
    const hints = hintsOf(
      { edit, publish, withdraw, reject, actors: { ...actors, 別の著者carol: { id: "carol", role: "author" } } },
      { action: "withdraw", reason: "自分の文書だけ" },
    );

    expect(hints.filter((x) => x.action === "withdraw" && x.kind === "same-for-similar-actors")).toHaveLength(1);
  });

  it("入力によって行き先が変わる操作は、可否が同じでも「入力を見ていない」としない", () => {
    const route = (d: Doc, u: User, to: "draft" | "published"): Doc => {
      ensure(u.role === "editor", "編集者だけ");
      return { ...d, status: to };
    };
    const hints = hintsOf({ edit, publish, withdraw, reject, route, inputs: { reject: { 理由あり: ["誤字"], 理由が空: [""] }, route: { 下書きへ: ["draft"], 公開へ: ["published"] } } });

    expect(kindsFor(hints, "route")).not.toContain("ignores-input");
  });

  it("ほかの入力の例と結果がまったく同じになった例は「区別されない入力の例」", () => {
    const rejectWithLimit = (d: Doc, u: User, comment: string): Doc => {
      ensure(comment.length <= 100, "100 文字まで");
      return reject(d, u, comment);
    };
    const mod = {
      edit,
      publish,
      withdraw,
      reject: rejectWithLimit,
      inputs: { reject: { 理由あり: ["誤字"], 理由が空: [""], 空白だけ: ["  "], 長すぎる: ["あ".repeat(101)] } },
    };

    const original = hintsOf(mod);
    const mutant = hintsOf(mod, { action: "reject", reason: "理由が必要" });

    expect(original.filter((h) => h.kind === "indistinguishable-example")).toEqual([]);
    expect(mutant).toContainEqual(expect.objectContaining({ kind: "indistinguishable-example", action: "reject" }));
  });

  it("ほかの登場人物とすべての操作で結果が同じになった登場人物は「区別されない登場人物」", () => {
    const guardedPublish = (d: Doc, u: User & { external?: boolean }): Doc => {
      ensure(u.external !== true, "外部サイト経由では公開できない");
      return publish(d, u);
    };
    const mod = { edit, publish: guardedPublish, withdraw, reject, actors: { ...actors, 外部サイト経由のeve: { id: "eve", role: "editor", external: true } } };

    const original = hintsOf(mod);
    const mutant = hintsOf(mod, { action: "publish", reason: "外部サイト経由では公開できない" });

    expect(original.filter((h) => h.kind === "indistinguishable-actor")).toEqual([]);
    expect(mutant).toContainEqual(expect.objectContaining({ kind: "indistinguishable-actor", action: null }));
  });

  it("どの操作の可否にも影響しない状態の項目は「参照されていない項目」", () => {
    const hints = hintsOf({ edit, publish, withdraw, reject });

    expect(hints).toContainEqual(expect.objectContaining({ kind: "unused-field", action: null, field: "flagged" }));
    expect(hints.find((h) => h.kind === "unused-field" && h.field === "status")).toBeUndefined();
  });
});
