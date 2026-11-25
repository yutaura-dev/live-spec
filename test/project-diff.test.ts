import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { diffModels, groupAvailability } from "../src/diff.ts";
import { diffProject } from "../src/project-diff.ts";
import { unionGraph } from "../src/render/union.ts";
import { renderDiffHtml } from "../src/render/diff-html.ts";
import { renderDiffMarkdown } from "../src/render/diff-markdown.ts";

const INDEX = new URL("../src/index.ts", import.meta.url).pathname;

const order = (opts: { staffCanCancel: boolean; refunded: boolean; question?: boolean }) => `import { ensure, ui } from "${INDEX}";
/** 注文 */
export type Order = { status: "注文済み" | "取り消し"${opts.refunded ? ' | "返金済み"' : ""} };
type User = { role: "客" | "店員" };
export const initial: Order = { status: "注文済み" };
export const actors: Record<string, User> = { 客: { role: "客" }, 店員: { role: "店員" } };
/** 取り消す */
export function cancel(o: Order, u: User): Order {
  ensure(${opts.staffCanCancel ? 'u.role === "客" || u.role === "店員", "客か店員だけ"' : 'u.role === "客", "客だけ"'});
  ensure(o.status === "注文済み", "注文済みのときだけ");
  return { status: "取り消し" };
}
${opts.refunded ? `/** 返金する */
export function refund(o: Order, u: User): Order {
  ensure(u.role === "店員", "店員だけ");
  ensure(o.status === "取り消し", "取り消したときだけ");
  return { status: "返金済み" };
}
export const scenarios = { 取り消して返金する: [{ do: cancel, by: "客" }, { do: refund, by: "店員", expect: { status: "返金済み" } }] };` : ""}
${opts.question ? 'export const questions = [{ ask: "返金に期限はあるか？" }];' : ""}
export function surface(o: Order, u: User) {
  return ui.screen("注文", ui.badge(o.status), o.status === "注文済み" && (u.role === "客"${opts.staffCanCancel ? ' || u.role === "店員"' : ""}) && ui.button("取り消す", cancel));
}
`;

const simple = (name: string, to = "b") => `import { ensure } from "${INDEX}";
export const initial = { s: "a" };
export const actors = { p: {} };
/** ${name}する */
export function go(x: { s: string }) { ensure(x.s === "a", "a のときだけ"); return { s: "${to}" }; }
`;

const repo = () => {
  const dir = mkdtempSync(join(tmpdir(), "live-spec-pdiff-"));
  const git = (...args: Array<string>) => execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", ...args], { cwd: dir });
  git("init", "-q", "-b", "main");
  mkdirSync(join(dir, "specs"));
  writeFileSync(join(dir, "specs", "order.spec.ts"), order({ staffCanCancel: false, refunded: false }));
  writeFileSync(join(dir, "specs", "legacy.spec.ts"), simple("古い"));
  writeFileSync(join(dir, "specs", "stable.spec.ts"), simple("変わらない"));
  git("add", "-A");
  git("commit", "-qm", "base");
  git("checkout", "-qb", "feature");
  writeFileSync(join(dir, "specs", "order.spec.ts"), order({ staffCanCancel: true, refunded: true, question: true }));
  rmSync(join(dir, "specs", "legacy.spec.ts"));
  writeFileSync(join(dir, "specs", "coupon.spec.ts"), simple("クーポン"));
  git("add", "-A");
  git("commit", "-qm", "head");
  return dir;
};

describe("diffModels: 検査結果の比べ方", () => {
  it("違反は同じで、最短の手順だけが変わったときは、差分にしない", () => {
    const model = (by: string) => ({
      states: [{ id: "s0", label: "a" }],
      transitions: [],
      availability: [],
      findings: [{ kind: "invariant-violation", invariant: "x", state: "s0", path: [{ action: "go", actor: by }] }],
    });

    const d = diffModels(model("alice"), model("bob"));

    expect(d.findings).toEqual({ added: [], removed: [] });
  });
});

describe("diffModels: 画面の比べ方", () => {
  it("消えた状態の画面は「画面の変化」に出さない（状態ごと消えたことは図でわかるため）", () => {
    const before = {
      states: [{ id: "s0", label: "a" }, { id: "s1", label: "b" }],
      transitions: [],
      availability: [],
      findings: [],
      surfaces: [{ state: "s1", actor: "p", surface: { kind: "text", text: "b の画面" } }],
    };
    const after = { states: [{ id: "s0", label: "a" }], transitions: [], availability: [], findings: [], surfaces: [] };

    expect(diffModels(before, after).surfaces).toEqual([]);
  });
});

describe("diffProject: base と head の spec を、ドメインオブジェクトごとに比べる", { timeout: 60_000 }, () => {
  const dir = repo();
  const result = diffProject({ cwd: dir, paths: ["specs"], base: "main", head: "feature" });

  it("ドメインオブジェクトごとに、追加・削除・変更・変化なしを判定する", async () => {
    const r = await result;

    expect(r.objects.map((o) => [o.name, o.status])).toEqual([
      ["coupon", "added"],
      ["legacy", "removed"],
      ["order", "changed"],
      ["stable", "unchanged"],
    ]);
  });

  it("変更したオブジェクトの、操作・状態・できる／できないの変化を求める", async () => {
    const o = (await result).objects.find((x) => x.name === "order")!;

    expect(o.diff.actions.added).toEqual(["refund"]);
    expect(o.diff.states.added).toEqual(["返金済み"]);
    expect(o.diff.availability).toContainEqual(
      expect.objectContaining({ state: "注文済み", action: "cancel", actor: "店員", before: "❌ 客だけ" }),
    );
  });

  it("できる／できないが変わったものと、できない理由の文言だけが変わったものを分ける", async () => {
    const o = (await result).objects.find((x) => x.name === "order")!;

    const g = groupAvailability(o.diff.availability);

    expect(g.flipped.map((a) => [a.state, a.action, a.actor])).toEqual([["注文済み", "cancel", "店員"]]);
    expect(g.reasonOnly).toContainEqual(
      expect.objectContaining({ action: "cancel", before: "❌ 客だけ", after: "❌ 注文済みのときだけ", count: 1 }),
    );
  });

  it("状態遷移図の重ね合わせで、通れる人が変わった遷移を示す", async () => {
    const o = (await result).objects.find((x) => x.name === "order")!;

    const { edges } = unionGraph(o.before!.graph, o.after!.graph);

    expect(edges.find((e) => e.action === "cancel")).toEqual(
      expect.objectContaining({ status: "changed", actorsAdded: ["店員"], actorsRemoved: [] }),
    );
  });

  it("シナリオと未決事項の増減も求める", async () => {
    const o = (await result).objects.find((x) => x.name === "order")!;

    expect(o.diff.scenarios.added).toEqual(["取り消して返金する"]);
    expect(o.diff.questions.added).toEqual(["返金に期限はあるか？"]);
  });

  it("head を省くと作業ツリーと比べる", async () => {
    writeFileSync(join(dir, "specs", "stable.spec.ts"), simple("変わらない", "c"));
    const r = await diffProject({ cwd: dir, paths: ["specs"], base: "feature" });

    expect(r.objects.find((o) => o.name === "stable")!.status).toBe("changed");
    expect(r.head).toBe("作業ツリー");
  });

  it("存在しないリビジョンを指定したら、そのリビジョン名を挙げて失敗する", async () => {
    await expect(diffProject({ cwd: dir, paths: ["specs"], base: "no-such-branch" })).rejects.toThrow(
      "リビジョン no-such-branch が見つかりません",
    );
  });

  it("Markdown に、まとめの表と、オブジェクトごとの変化と、色分けした状態遷移図を書く", async () => {
    const md = renderDiffMarkdown(await result);

    expect(md).toContain("| [order](#order) | 変更 |");
    expect(md).toContain("## order（変更）");
    expect(md).toContain("classDef added");
    expect(md).toMatch(/class \w+ added/);
    expect(md).toContain("変化なし: stable");
  });

  it("HTML に、重ね合わせた状態遷移図と、変わった画面の変更前・変更後を出す", async () => {
    const html = await renderDiffHtml(await result);

    expect(html).toContain('class="node diff-added"');
    expect(html).toContain('class="edge diff-added"');
    expect(html).toContain('<div class="before-after">');
    expect(html).toContain('class="edge diff-changed"');
    expect(html).toContain("cancel ＋店員");
  });
});
