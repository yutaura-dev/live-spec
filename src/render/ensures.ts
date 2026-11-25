import type { EnsureCheck } from "../model.ts";

const effectText = (e: EnsureCheck): string => {
  const first = e.effects[0];
  if (first === undefined) return `状態「${e.newStates.join("」「")}」に入れるようになる`;
  const who = first.input === null ? first.actor : `${first.actor}（${first.input}）`;
  const rest = e.effects.length > 1 ? ` ほか ${e.effects.length - 1} 件` : "";
  return `${who} が ${first.state} で実行できるようになる（${first.after.replace(/^✅ /, "")}）${rest}`;
};

const effectOf = (e: EnsureCheck, acknowledged: boolean): string => {
  switch (e.verdict) {
    case "caught":
      return `外すと、${e.caughtBy.join("・")}が気づく`;
    case "unguarded":
      return `外すと、${effectText(e)}。気づくものがない${acknowledged ? "（確認済み）" : ""}`;
    case "no-effect":
      return "外しても振る舞いが変わらない（ほかの条件と重なっている）";
  }
};

// 理由の文と「実際に通るとき」を並べる理由: 理由の文は書き手の意図をもう一度書いたものなので、
// 実行して求めた事実と見比べると、状態の取り違えのような書き間違いが見える。
export const describeEnsure = (e: EnsureCheck, acknowledged = false): string =>
  `${e.verdict === "unguarded" && !acknowledged ? "⚠ " : ""}「${e.reason}」— 通るのは ${e.passes}。${effectOf(e, acknowledged)}`;
