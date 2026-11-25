import { describe, expect, it } from "vitest";
import { loadSpec } from "../src/load.ts";
import * as Article from "./fixtures/article.spec.ts";

describe("loadSpec: spec ファイルの export を仕様として読み取る", () => {
  it("initial と actors 以外の export された関数を操作とみなし、ソースがなければ名前順に並べる", () => {
    const spec = loadSpec("article", Article);

    expect(spec.actions.map(([name]) => name)).toEqual(["archive", "pin", "publish", "submit"]);
  });

  it("ソースを渡すと、操作をソースに書かれた順に並べる", () => {
    const source = "export function submit() {}\nexport const publish = () => {};\nexport async function pin() {}\nexport function archive() {}";

    const spec = loadSpec("article", Article, { source });

    expect(spec.actions.map(([name]) => name)).toEqual(["submit", "publish", "pin", "archive"]);
  });

  it("invariants の関数を不変条件として読み、操作には含めない", () => {
    const spec = loadSpec("x", { initial: {}, actors: {}, invariants: { 常に真: () => true }, act: () => ({}) });

    expect(spec.invariants.map(([name]) => name)).toEqual(["常に真"]);
    expect(spec.actions.map(([name]) => name)).toEqual(["act"]);
  });

  it("initial がなければエラーにする", () => {
    expect(() => loadSpec("broken", { actors: {} })).toThrow("initial");
  });

  it("actors がなければエラーにする", () => {
    expect(() => loadSpec("broken", { initial: {} })).toThrow("actors");
  });
});
