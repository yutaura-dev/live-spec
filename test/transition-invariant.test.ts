import { describe, expect, it } from "vitest";
import { ensure } from "../src/ensure.ts";
import { explore } from "../src/explore.ts";
import { loadSpec } from "../src/load.ts";
import { renderMarkdown } from "../src/render/markdown.ts";
import { checkEnsures } from "../src/mutation.ts";

type Job = { status: "queued" | "running" | "done" };
const isDone = (j: Job) => j.status === "done";

const jobSpec = (overrides: Record<string, unknown> = {}) =>
  loadSpec("job", {
    initial: { status: "queued" } satisfies Job,
    actors: { ワーカー: {} },
    start: (j: Job) => {
      ensure(j.status === "queued", "待機中のときだけ");
      return { ...j, status: "running" };
    },
    finish: (j: Job) => {
      ensure(j.status === "running", "実行中のときだけ");
      return { ...j, status: "done" };
    },
    // 終わったジョブをやり直せてしまう（遷移の不変条件で見つけたい書き間違い）
    restart: (j: Job) => {
      ensure(j.status !== "queued", "待機中でないときだけ");
      return { ...j, status: "queued" };
    },
    invariants: { 終わったジョブは変わらない: (before: Job, after: Job) => !isDone(before) || isDone(after) },
    ...overrides,
  });

describe("遷移の不変条件（引数を 2 つとる不変条件）", () => {
  it("遷移の前後で成り立たない遷移を、その遷移までの最短手順とともに検出する", () => {
    const spec = jobSpec();
    const graph = explore(spec);
    const id = (status: string) => graph.states.find((s) => s.values.status === status)!.id;

    const found = graph.findings.filter((f) => f.kind === "transition-invariant-violation");

    expect(found).toEqual([
      {
        kind: "transition-invariant-violation",
        invariant: "終わったジョブは変わらない",
        from: id("done"),
        to: id("queued"),
        action: "restart",
        actor: "ワーカー",
        path: [
          { action: "start", actor: "ワーカー" },
          { action: "finish", actor: "ワーカー" },
          { action: "restart", actor: "ワーカー" },
        ],
      },
    ]);
  });

  it("遷移の不変条件は、1 つの状態についての不変条件としては調べない", () => {
    const graph = explore(jobSpec());

    expect(graph.findings.filter((f) => f.kind === "invariant-violation")).toEqual([]);
  });

  it("関数が例外を投げた遷移は、違反として扱う", () => {
    const spec = jobSpec({
      invariants: {
        例外を投げる: (_before: Job, _after: Job) => {
          throw new Error("boom");
        },
      },
    });

    expect(explore(spec).findings.filter((f) => f.kind === "transition-invariant-violation").length).toBeGreaterThan(0);
  });

  it("Markdown の検査結果に、破った遷移と手順を書く", () => {
    const spec = jobSpec();

    expect(renderMarkdown(spec, explore(spec))).toContain(
      "不変条件「終わったジョブは変わらない」を restart (ワーカー) の done → queued で破る（start (ワーカー) → finish (ワーカー) → restart (ワーカー)）",
    );
  });

  it("ensure を外したときに遷移の不変条件が気づけば、その条件は意図が書かれている（caught）", () => {
    const spec = jobSpec({
      restart: (j: Job) => {
        ensure(j.status === "running", "実行中のときだけ");
        return { ...j, status: "queued" };
      },
    });
    const graph = explore(spec);

    const check = checkEnsures(spec, graph).find((c) => c.action === "restart");

    expect(check).toMatchObject({ verdict: "caught", caughtBy: ["不変条件「終わったジョブは変わらない」"] });
  });
});
