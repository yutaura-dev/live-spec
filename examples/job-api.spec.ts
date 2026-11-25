import { api, ensure } from "../src/index.ts";

/** 非同期ジョブの API。クライアントがジョブを作り、ワーカーが実行する。クライアントは完了をポーリングで待つ。 */
export type Job = {
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  ownerId: string;
};

type Caller = { kind: "client"; id: string } | { kind: "worker" };

export const initial: Job = { status: "queued", ownerId: "c1" };

// ワーカーも登場人物として並べる。クライアントからは起こせない遷移（開始・完了・失敗）は
// ワーカーだけが起こせる、ということが「できる人」の欄にそのまま表れる。
export const actors: Record<string, Caller> = {
  作成したクライアント: { kind: "client", id: "c1" },
  別のクライアント: { kind: "client", id: "c2" },
  ワーカー: { kind: "worker" },
};

const isOwner = (job: Job, caller: Caller) => caller.kind === "client" && caller.id === job.ownerId;

/** ワーカーがジョブを取り出して実行を始める */
export function start(job: Job, caller: Caller): Job {
  ensure(caller.kind === "worker", "ワーカーだけ");
  ensure(job.status === "queued", "待機中のときだけ");
  return { ...job, status: "running" };
}

/** ワーカーが実行を終える */
export function succeed(job: Job, caller: Caller): Job {
  ensure(caller.kind === "worker", "ワーカーだけ");
  ensure(job.status === "running", "実行中のときだけ");
  return { ...job, status: "succeeded" };
}

/** ワーカーが失敗を報告する */
export function fail(job: Job, caller: Caller): Job {
  ensure(caller.kind === "worker", "ワーカーだけ");
  ensure(job.status === "running", "実行中のときだけ");
  return { ...job, status: "failed" };
}

/** DELETE /jobs/{id}: ジョブを取り消す */
export function cancel(job: Job, caller: Caller): Job {
  ensure(isOwner(job, caller), "ジョブを作ったクライアントだけ");
  ensure(job.status === "queued" || job.status === "running", "終わっていないときだけ");
  return { ...job, status: "cancelled" };
}

/** POST /jobs/{id}/retry: 失敗したジョブをやり直す */
export function retry(job: Job, caller: Caller): Job {
  ensure(isOwner(job, caller), "ジョブを作ったクライアントだけ");
  ensure(job.status === "failed", "失敗したときだけ");
  return { ...job, status: "queued" };
}

/** GET /jobs/{id} の応答。ワーカーはこの API を呼ばないので、見える画面はない（null）。 */
export function surface(job: Job, caller: Caller) {
  if (caller.kind === "worker") return null;
  if (!isOwner(job, caller)) return api.response(404, { error: "not_found" });
  return api.response(200, { id: "job_1", status: job.status, ...(job.status === "failed" ? { error: { code: "timeout" } } : {}) });
}
