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
  ジョブを作ったクライアント: { kind: "client", id: "c1" },
  別のクライアント: { kind: "client", id: "c2" },
  ワーカー: { kind: "worker" },
};

const isFinished = (job: Job) => job.status === "succeeded" || job.status === "cancelled";

// 引数を 2 つとる不変条件は、遷移の前と後についての決まり（ライフサイクルの決まり）。
// 失敗（failed）はやり直せるので「終わった」に入れない。
export const invariants = {
  成功か取り消しで終わったジョブは変わらない: (before: Job, after: Job) => !isFinished(before) || before.status === after.status,
};

const isOwner = (job: Job, caller: Caller) => caller.kind === "client" && caller.id === job.ownerId;

/** ワーカーがジョブを取り出して実行を始める */
export function start(job: Job, caller: Caller): Job {
  ensure(caller.kind === "worker", "ワーカーだけ");
  ensure(job.status === "queued", "待機中のときだけ");
  return { ...job, status: "running" };
}

/** ワーカーが実行を終えて成功にする */
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
  ensure(job.status === "queued" || job.status === "running", "待機中か実行中のときだけ");
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
