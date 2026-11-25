import { describe, expect, it } from "vitest";
import { ensure } from "../src/ensure.ts";
import { ensureScope } from "../src/ensure-scope.ts";
import { explore } from "../src/explore.ts";
import { loadSpec } from "../src/load.ts";

type Job = { status: "queued" | "running" | "done"; ownerId: string };
type User = { id: string; role: "client" | "worker" };

const start = (j: Job, u: User): Job => {
  ensure(u.role === "worker", "ワーカーだけ");
  ensure(j.status === "queued", "待機中のときだけ");
  return { ...j, status: "running" };
};
const finish = (j: Job, u: User): Job => {
  ensure(u.role === "worker", "ワーカーだけ");
  ensure(j.status === "running", "実行中のときだけ");
  ensure(j.ownerId !== "", "持ち主がいるときだけ");
  return { ...j, status: "done" };
};
const cancel = (j: Job, u: User): Job => {
  ensure(u.id === j.ownerId, "作った人だけ");
  ensure(j.status !== "done", "終わっていないときだけ");
  return { ...j, status: "done" };
};

const spec = loadSpec("job", {
  initial: { status: "queued", ownerId: "c1" },
  actors: { クライアントc1: { id: "c1", role: "client" }, 別のクライアントc2: { id: "c2", role: "client" }, ワーカーw: { id: "w", role: "worker" } },
  start,
  finish,
  cancel,
});
const graph = explore(spec);
const scopeOf = (action: string, reason: string) => ensureScope(spec, graph, action, reason);

describe("ensure の実際: その ensure だけを効かせて実行し、通るのがどんなときかを求める", () => {
  it("状態だけで決まる条件は、状態の項目の値で表す", () => {
    expect(scopeOf("start", "待機中のときだけ")).toEqual({ dimension: "state", passes: "status が queued のとき" });
    expect(scopeOf("cancel", "終わっていないときだけ")).toEqual({ dimension: "state", passes: "status が queued, running のとき" });
  });

  it("登場人物だけで決まる条件は、通る登場人物で表す", () => {
    expect(scopeOf("start", "ワーカーだけ")).toEqual({ dimension: "actor", passes: "ワーカーw のとき" });
  });

  it("状態の項目と登場人物の属性が同じかどうかで決まる条件は、その関係で表す", () => {
    expect(scopeOf("cancel", "作った人だけ")).toEqual({ dimension: "relation", passes: "ownerId が登場人物の id と同じとき" });
  });

  it("一度も止めない条件は、そう示す", () => {
    expect(scopeOf("finish", "持ち主がいるときだけ")).toEqual({ dimension: "none", passes: "到達できるどの場合も通る（この条件で止まることがない）" });
  });

  it("調べたあとは、ensure が元どおりすべて止める", () => {
    scopeOf("start", "待機中のときだけ");

    expect(() => ensure(false, "ワーカーだけ")).toThrow("ワーカーだけ");
  });
});
