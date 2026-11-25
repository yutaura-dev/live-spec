import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { explore } from "../src/explore.ts";
import { loadSpec } from "../src/load.ts";
import * as Minimal from "../examples/minimal.spec.ts";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("examples: README に載せている例", () => {
  it("minimal.spec.ts は検査で問題が出ない", () => {
    const spec = loadSpec("minimal", Minimal, { source: source("../examples/minimal.spec.ts") });

    expect(explore(spec).findings).toEqual([]);
  });

  it("README には minimal.spec.ts と同じコードを載せている", () => {
    expect(source("../README.md")).toContain(source("../examples/minimal.spec.ts").trim());
  });
});
