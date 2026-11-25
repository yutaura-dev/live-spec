import { describe, expect, it } from "vitest";
import { analyze } from "../src/static.ts";

describe("analyze: spec ファイルのソースを構文解析する", () => {
  it("名前付き export を、ソースに書かれた順に返す", () => {
    const source = "export function submit() {}\nexport const publish = () => {};\nexport async function pin() {}";

    expect(analyze(source).order).toEqual(["submit", "publish", "pin"]);
  });

  it("export の直前の JSDoc の最初の段落を、その export の説明文にする", () => {
    const source = "/** 公開する\n *\n * 詳しい説明 */\nexport function publish() {}\nexport function archive() {}";

    expect(analyze(source).docs).toEqual({ publish: "公開する" });
  });

  it("最初の段落が複数行にわたるときは、途中で切らずにつなげる", () => {
    const source = "/** ローカルのサーバが仕様書を\n * 配信する。\n *\n * 次の段落 */\nexport function serve() {}";

    expect(analyze(source).docs).toEqual({ serve: "ローカルのサーバが仕様書を配信する。" });
  });

  it("英語の行をつなげるときは、間に空白を入れる", () => {
    const source = "/** Serves the spec\n * over HTTP. */\nexport function serve() {}";

    expect(analyze(source).docs).toEqual({ serve: "Serves the spec over HTTP." });
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
