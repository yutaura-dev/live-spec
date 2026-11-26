import { describe, expect, it } from "vitest";
import { isSpecModuleUrl } from "../src/spec-loader.ts";

describe("isSpecModuleUrl: ES module として読ませるファイル", () => {
  it.each([
    ["file:///p/specs/order.spec.ts?v=3", true],
    ["file:///p/specs/.order.spec.live-spec-base.ts", true],
    ["file:///p/specs/.order.spec.mutant.ts", true],
    ["file:///p/src/helper.ts", false],
    ["file:///p/specs/order.spec.js", false],
    ["node:fs", false],
  ])("%s → %s", (url, expected) => {
    expect(isSpecModuleUrl(url)).toBe(expected);
  });
});
