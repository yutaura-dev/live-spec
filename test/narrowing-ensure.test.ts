import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadObject } from "../src/generate.ts";
import { renderMarkdown } from "../src/render/markdown.ts";
import { analyze } from "../src/static.ts";

const INDEX = new URL("../src/index.ts", import.meta.url).pathname;

const SOURCE = `import { ensure } from "${INDEX}";
export type Run = { status: "停止中" | "実行中" };
type Actor = { kind: "human"; via: "browser" | "machine" } | { kind: "worker" };
export const initial: Run = { status: "停止中" };
export const actors: Record<string, Actor> = {
  画面の人: { kind: "human", via: "browser" },
  機械の人: { kind: "human", via: "machine" },
  ワーカー: { kind: "worker" },
};
export function resume(run: Run, actor: Actor): Run {
  ensure(actor.kind === "human", "人だけ");
  ensure(actor.via === "browser", "画面（ブラウザのログイン）からだけ");
  ensure(run.status === "停止中", "停止中のときだけ");
  return { status: "実行中" };
}
`;

describe("型を絞るための ensure", { timeout: 30_000 }, () => {
  it("判別のための項目を比べ、後ろで同じ値の別の項目を読む ensure を、型を絞る条件として見分ける", () => {
    const calls = analyze(SOURCE).ensures.resume!;

    expect(calls[0]).toEqual({ reason: "人だけ", line: 11, narrowing: true });
    expect(calls[1]!.narrowing).toBeUndefined();
    expect(calls[2]!.narrowing).toBeUndefined();
  });

  it("外しても振る舞いが変わらないときは、重なりではなく型を絞る条件と示す", async () => {
    const dir = mkdtempSync(join(tmpdir(), "live-spec-narrow-"));
    writeFileSync(join(dir, "run.spec.ts"), SOURCE);
    const { spec, graph } = await loadObject(join(dir, "run.spec.ts"));

    const md = renderMarkdown(spec, graph);

    expect(md).toContain("「人だけ」— 通るのは");
    expect(md).toContain("外しても振る舞いが変わらない（後の条件のために型を絞る条件）");
    expect(md).not.toContain("「人だけ」— 通るのは 画面の人, 機械の人 のとき。外しても振る舞いが変わらない（ほかの条件と重なっている）");
  });
});
