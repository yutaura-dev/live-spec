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

  it("initial がなければエラーにする", () => {
    expect(() => loadSpec("broken", { actors: {} })).toThrow("initial");
  });

  it("actors がなければエラーにする", () => {
    expect(() => loadSpec("broken", { initial: {} })).toThrow("actors");
  });
});
