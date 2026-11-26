import { describe, expect, it } from "vitest";
import { ensure } from "../src/ensure.ts";
import { explore } from "../src/explore.ts";
import { loadSpec } from "../src/load.ts";
import { findOmissionHints } from "../src/omission.ts";

type Job = { status: "待機" | "実行中" | "中断" | "成功" | "失敗"; exhausted: boolean };

const start = (j: Job): Job => {
  ensure(j.status === "待機", "待機のときだけ");
  ensure(!j.exhausted, "試行の上限に届いていないときだけ");
  return { ...j, status: "実行中" };
};
const succeed = (j: Job): Job => {
  ensure(j.status === "実行中", "実行中のときだけ");
  return { ...j, status: "成功" };
};
const suspend = (j: Job): Job => {
  ensure(j.status === "実行中", "実行中のときだけ");
  return { status: "中断", exhausted: true };
};
const resume = (j: Job): Job => {
  ensure(j.status === "中断", "中断のときだけ");
  return { ...j, status: "待機" };
};
const fail = (j: Job): Job => {
  ensure(j.status === "待機" || j.status === "実行中", "終わっていないときだけ");
  return { ...j, status: "失敗" };
};

const specWith = (extra: Record<string, unknown>) =>
  loadSpec("job", { initial: { status: "待機", exhausted: false }, actors: { 人: {} }, start, succeed, suspend, resume, fail, ...extra });

describe("goals: 目指す状態にたどり着けない状態（袋小路）を見つける", () => {
  it("終端ではないのに目指す状態にたどり着けない状態のうち、入口の状態を、最短の手順つきで出す", () => {
    const spec = specWith({ goals: { 成功: (j: Job) => j.status === "成功" } });

    const hints = findOmissionHints(spec, explore(spec)).filter((h) => h.kind === "cannot-reach-goal");

    expect(hints).toEqual([
      {
        id: "cannot-reach-goal:中断 · exhausted",
        kind: "cannot-reach-goal",
        action: null,
        field: null,
        message: "状態「中断 · exhausted」は終端ではないのに、目指す状態（成功）のどれにもたどり着けない。入る手順: start（人） → suspend（人）",
      },
    ]);
  });

  it("入る手順には、操作の入力の例の名前を添える", () => {
    const begin = (j: Job, _u: object, last: boolean): Job => {
      ensure(j.status === "待機", "待機のときだけ");
      ensure(!j.exhausted, "試行の上限に届いていないときだけ");
      return { status: "実行中", exhausted: last };
    };
    const pause = (j: Job): Job => {
      ensure(j.status === "実行中", "実行中のときだけ");
      return { ...j, status: "中断" };
    };
    const spec = loadSpec("job", {
      initial: { status: "待機", exhausted: false },
      actors: { 人: {} },
      inputs: { begin: { まだ残る: [false], 最後の試行になる: [true] } },
      goals: { 成功: (j: Job) => j.status === "成功" },
      begin,
      succeed,
      pause,
      resume,
      fail,
    });

    const messages = findOmissionHints(spec, explore(spec))
      .filter((h) => h.kind === "cannot-reach-goal")
      .map((h) => h.message);

    expect(messages.join("\n")).toContain("入る手順: begin（人、最後の試行になる） → pause（人）");
  });

  it("goals を書かなければ、袋小路を調べない", () => {
    const spec = specWith({});

    expect(findOmissionHints(spec, explore(spec)).filter((h) => h.kind === "cannot-reach-goal")).toEqual([]);
  });

  it("どの状態からもたどり着けない目指す状態は、検査結果に出す", () => {
    const spec = specWith({ goals: { 取り消し: (j: Job) => j.status === ("取り消し" as Job["status"]) } });

    expect(explore(spec).findings).toContainEqual({ kind: "goal-unreachable", goal: "取り消し" });
  });
});
