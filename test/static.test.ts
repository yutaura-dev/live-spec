import { describe, expect, it } from "vitest";
import { analyze } from "../src/static.ts";

describe("analyze: spec ファイルのソースを構文解析する", () => {
  it("名前付き export を、ソースに書かれた順に返す", () => {
    const source = "export function submit() {}\nexport const publish = () => {};\nexport async function pin() {}";

    expect(analyze(source).order).toEqual(["submit", "publish", "pin"]);
  });

  it("export の直前の JSDoc の 1 行目を、その export の説明文にする", () => {
    const source = "/** 公開する\n * 詳しい説明 */\nexport function publish() {}\nexport function archive() {}";

    expect(analyze(source).docs).toEqual({ publish: "公開する" });
  });

  it("initial の型注釈から同じファイルの型を辿り、有限の値をとる項目の値を列挙する", () => {
    const source = [
      "/** ブログ記事 */",
      'export type Article = { status: "draft" | "published"; pinned: boolean; authorId: string };',
      'export const initial: Article = { status: "draft", pinned: false, authorId: "alice" };',
    ].join("\n");

    const info = analyze(source);

    expect(info.fields).toEqual({ status: ["draft", "published"], pinned: [false, true] });
    expect(info.stateDoc).toBe("ブログ記事");
  });

  it("interface で書かれた型も辿る", () => {
    const source = 'interface Order { status: "open" | "closed" }\nexport const initial: Order = { status: "open" };';

    expect(analyze(source).fields).toEqual({ status: ["open", "closed"] });
  });

  it("initial に型注釈がなければ、項目の値は分からないものとして空にする", () => {
    expect(analyze('export const initial = { status: "open" };').fields).toEqual({});
  });
});
