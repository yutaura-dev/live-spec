import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as Record<string, unknown>;

describe("package.json: npm のページから、リポジトリと不具合の報告先へ辿れる", () => {
  it("repository・bugs・homepage が GitHub のリポジトリを指す", () => {
    expect(pkg.repository).toEqual({ type: "git", url: "git+https://github.com/yutaura-dev/live-spec.git" });
    expect(pkg.bugs).toBe("https://github.com/yutaura-dev/live-spec/issues");
    expect(pkg.homepage).toBe("https://github.com/yutaura-dev/live-spec#readme");
  });
});

describe("package.json: テスト用のヘルパーを別の入口で配る", () => {
  it("@yutaura/live-spec/testing で specOf を読み込める", () => {
    expect((pkg.exports as Record<string, unknown>)["./testing"]).toEqual({ types: "./dist/testing.d.ts", default: "./dist/testing.js" });
  });
});
