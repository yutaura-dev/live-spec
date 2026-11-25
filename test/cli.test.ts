import { describe, expect, it } from "vitest";
import { outputFormatOf, specNameOf } from "../src/cli.ts";

describe("outputFormatOf: 出力形式をフラグから決める", () => {
  it("フラグがなければ Markdown にする", () => {
    expect(outputFormatOf([])).toBe("markdown");
  });

  it("--html なら HTML、--json なら JSON にする", () => {
    expect(outputFormatOf(["--html"])).toBe("html");
    expect(outputFormatOf(["--json"])).toBe("json");
  });
});

describe("specNameOf: ファイル名から spec 名を決める", () => {
  it(".spec.ts を除いたファイル名を spec 名にする", () => {
    expect(specNameOf("examples/article.spec.ts")).toBe("article");
  });

  it(".spec を含まない .ts でも拡張子を除く", () => {
    expect(specNameOf("/abs/path/order.ts")).toBe("order");
  });
});
