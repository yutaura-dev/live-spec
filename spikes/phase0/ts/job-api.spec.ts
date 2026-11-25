// 題材 B: ジョブ管理 API — TS DSL 案
// 比較用のスケッチ。"live-spec" パッケージは存在しないため型チェックは通らない。
import { spec, http } from "live-spec";

const getJob = (body: Record<string, unknown>) => http.get("/jobs/{id}").responds(200, { id: "job_1", ...body });
const cancel = { to: "cancelled", do: http.delete("/jobs/{id}") } as const;

export default spec({
  id: "job-api",
  kind: "api",
  title: "非同期ジョブ",
  summary: "クライアントがジョブを作成し、ポーリングで完了を待つ。実行中のジョブはキャンセルできる。",
  initial: "queued",
  entry: http.post("/jobs", { type: "export-csv" }),
  states: {
    queued: {
      summary: "実行待ち",
      surface: [getJob({ status: "queued" })],
      on: { WORKER_STARTED: { to: "running", trigger: "system" }, CANCEL: cancel },
    },
    running: {
      summary: "実行中",
      surface: [getJob({ status: "running", progress: 0.4 })],
      on: {
        WORKER_SUCCEEDED: { to: "succeeded", trigger: "system" },
        WORKER_FAILED: { to: "failed", trigger: "system" },
        CANCEL: cancel,
      },
    },
    succeeded: {
      summary: "完了",
      final: true,
      surface: [
        getJob({ status: "succeeded", resultUrl: "https://..." }),
        http.delete("/jobs/{id}").responds(409, { error: "already_finished" }),
      ],
    },
    failed: { summary: "失敗", final: true, surface: [getJob({ status: "failed", error: { code: "timeout" } })] },
    cancelled: { summary: "キャンセル済み", final: true, surface: [getJob({ status: "cancelled" })] },
  },
  scenarios: [
    { id: "poll-until-done", summary: "ポーリングすると最終的に成功する", path: ["queued", "running", "succeeded"] },
    { id: "cancel-while-running", summary: "実行中にキャンセルできる", path: ["queued", "running", "cancelled"] },
  ],
  questions: [
    { id: "retry", on: "failed", ask: "失敗したジョブを再実行する API（POST /jobs/{id}/retry）は持つか？" },
    { id: "cancel-race", on: "running", ask: "キャンセルと完了がほぼ同時に起きたら、どちらを優先するか？" },
  ],
});
