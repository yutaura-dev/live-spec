// 題材 A: ログインフロー（UI）— TS DSL 案
// 比較用のスケッチ。"live-spec" パッケージは存在しないため型チェックは通らない。
import { spec, guard, ui } from "live-spec";

const canSubmit = guard("両方の欄が入力済み", (c) => c.email !== "" && c.password !== "");
const willLock = guard("今回の失敗でロックに達する", (c) => c.failedAttempts + 1 >= 5, [
  { given: { failedAttempts: 3 }, expect: false },
  { given: { failedAttempts: 4 }, expect: true },
]);

export default spec({
  id: "login",
  kind: "ui",
  title: "ログイン",
  summary: "メールアドレスとパスワードでログインする。5 回連続で失敗するとアカウントをロックする。",
  context: { failedAttempts: 0, email: "", password: "", lastError: null as string | null },
  initial: "editing",
  states: {
    editing: {
      summary: "入力中",
      surface: ui(
        ui.heading("ログイン"),
        ui.input("email", "メールアドレス"),
        ui.input("password", "パスワード", { secret: true }),
        ui.text("error", { visible: (c) => c.lastError != null }),
        ui.button("submit", "ログイン", { enabled: canSubmit }),
      ),
      on: { SUBMIT: { to: "submitting", guard: canSubmit, do: ui.click("submit") } },
    },
    submitting: {
      summary: "認証中",
      surface: ui(ui.heading("ログイン"), ui.button("submit", "ログイン中…", { enabled: false }), ui.spinner()),
      on: {
        AUTH_OK: { to: "loggedIn", trigger: "system" },
        AUTH_NG: [
          { to: "locked", guard: willLock, trigger: "system" },
          {
            to: "editing",
            trigger: "system",
            effect: (c) => ({ ...c, failedAttempts: c.failedAttempts + 1, lastError: "メールアドレスまたはパスワードが違います" }),
          },
        ],
      },
    },
    locked: {
      summary: "ロック中",
      final: true,
      surface: ui(ui.heading("アカウントがロックされました"), ui.text("lockMessage", { value: "しばらく経ってから再度お試しください" })),
    },
    loggedIn: { summary: "ログイン完了", final: true, surface: ui(ui.redirect("/home")) },
  },
  scenarios: [
    { id: "happy-path", summary: "正しい認証情報でログインできる", path: ["editing", "submitting", "loggedIn"] },
    { id: "lock-after-5-failures", summary: "5 回失敗するとロックされる", given: { failedAttempts: 4 }, path: ["editing", "submitting", "locked"] },
  ],
  questions: [
    { id: "unlock", on: "locked", ask: "ロックの解除方法は？（時間経過 / メールリンク / 管理者）" },
    { id: "reset-count", on: "loggedIn", ask: "ログインに成功したら failedAttempts を 0 に戻すか？" },
  ],
});
