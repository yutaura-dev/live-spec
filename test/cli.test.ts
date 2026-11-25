import { describe, expect, it } from "vitest";
import { specNameOf } from "../src/cli.ts";

describe("specNameOf: ファイル名から spec 名を決める", () => {
  it(".spec.ts を除いたファイル名を spec 名にする", () => {
    expect(specNameOf("examples/article.spec.ts")).toBe("article");
  });

  it(".spec を含まない .ts でも拡張子を除く", () => {
    expect(specNameOf("/abs/path/order.ts")).toBe("order");
  });
});
