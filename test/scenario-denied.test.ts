import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ensure } from "../src/ensure.ts";
import { explore } from "../src/explore.ts";
import { loadObject } from "../src/generate.ts";
import { loadSpec } from "../src/load.ts";
import { renderMarkdown } from "../src/render/markdown.ts";

type Doc = { approved: boolean };
type User = { role: "author" | "editor" };

const approve = (d: Doc, u: User): Doc => {
  ensure(u.role === "editor", "編集者だけ");
  ensure(!d.approved, "未承認のときだけ");
  return { approved: true };
};

const specWith = (scenarios: Record<string, unknown>) =>
  loadSpec("doc", {
    initial: { approved: false },
    actors: { 著者alice: { role: "author" }, 編集者eve: { role: "editor" } },
    approve,
    scenarios,
  });

describe("シナリオの denied: この手順は断られるはず、と書ける", () => {
  it("書いた理由で断られれば、その手順は通り、状態は変わらずに次の手順へ進む", () => {
    const graph = explore(
      specWith({
        著者は承認できない: [
          { do: approve, by: "著者alice", denied: "編集者だけ" },
          { do: approve, by: "編集者eve", expect: { approved: true } },
        ],
      }),
    );

    expect(graph.scenarios[0]!.passed).toBe(true);
    expect(graph.scenarios[0]!.steps[0]).toEqual(expect.objectContaining({ ok: true, denied: true, reason: "編集者だけ" }));
    expect(graph.findings).toEqual([]);
  });

  it("断られるはずの手順が実行できてしまったら、シナリオは失敗する", () => {
    const graph = explore(specWith({ 編集者は断られる: [{ do: approve, by: "編集者eve", denied: true }] }));

    expect(graph.scenarios[0]!.passed).toBe(false);
    expect(graph.findings).toContainEqual(
      expect.objectContaining({ kind: "scenario-failed", reason: "断られるはずが、実行できた" }),
    );
  });

  it("断られた理由が書いた理由と違えば、シナリオは失敗する", () => {
    const graph = explore(
      specWith({
        二度目の承認: [
          { do: approve, by: "編集者eve" },
          { do: approve, by: "編集者eve", denied: "編集者だけ" },
        ],
      }),
    );

    expect(graph.findings).toContainEqual(
      expect.objectContaining({ kind: "scenario-failed", reason: "断られる理由が違う: 期待「編集者だけ」、実際「未承認のときだけ」" }),
    );
  });

  it("Markdown のシナリオに、断られる手順を断られた理由つきで出す", () => {
    const spec = specWith({ 著者は承認できない: [{ do: approve, by: "著者alice", denied: "編集者だけ" }] });

    const md = renderMarkdown(spec, explore(spec));

    expect(md).toContain("1. 著者alice が approve（approve）: 断られる（編集者だけ）");
  });
});

describe("ensure のミューテーションと denied", { timeout: 30_000 }, () => {
  it("denied の手順があれば、その ensure を外したときにシナリオが気づく", async () => {
    const INDEX = new URL("../src/index.ts", import.meta.url).pathname;
    const dir = mkdtempSync(join(tmpdir(), "live-spec-denied-"));
    writeFileSync(
      join(dir, "doc.spec.ts"),
      `import { ensure } from "${INDEX}";
export type Doc = { approved: boolean };
type User = { role: "author" | "editor" };
export const initial: Doc = { approved: false };
export const actors: Record<string, User> = { 著者alice: { role: "author" }, 編集者eve: { role: "editor" } };
export function approve(d: Doc, u: User): Doc {
  ensure(u.role === "editor", "編集者だけ");
  ensure(!d.approved, "未承認のときだけ");
  return { approved: true };
}
export const scenarios = { 著者は承認できない: [{ do: approve, by: "著者alice", denied: "編集者だけ" }] };
`,
    );

    const { graph } = await loadObject(join(dir, "doc.spec.ts"));

    expect(graph.ensures!.find((e) => e.reason === "編集者だけ")).toEqual(
      expect.objectContaining({ verdict: "caught", caughtBy: ["シナリオ「著者は承認できない」"] }),
    );
  });
});
