import type { EnsureCheck } from "../model.ts";

const effectText = (e: EnsureCheck): string => {
  const first = e.effects[0];
  if (first === undefined) return `状態「${e.newStates.join("」「")}」に入れるようになる`;
  const who = first.input === null ? first.actor : `${first.actor}（${first.input}）`;
  const rest = e.effects.length > 1 ? ` ほか ${e.effects.length - 1} 件` : "";
  return `${who} が ${first.state} で実行できるようになる（${first.after.replace(/^✅ /, "")}）${rest}`;
};

export const describeEnsure = (e: EnsureCheck): string => {
  switch (e.verdict) {
    case "caught":
      return `「${e.reason}」を外すと、${e.caughtBy.join("・")}が気づく`;
    case "unguarded":
      return `⚠ 「${e.reason}」を外すと、${effectText(e)}。気づくものがない`;
    case "no-effect":
      return `「${e.reason}」は外しても振る舞いが変わらない（ほかの条件と重なっている）`;
  }
};

export const unguardedEnsures = (ensures: ReadonlyArray<EnsureCheck> | undefined) => (ensures ?? []).filter((e) => e.verdict === "unguarded");

export const UNGUARDED_TITLE = "意図がほかに書かれていない条件";
export const UNGUARDED_LEAD =
  "次の条件は、外しても不変条件・シナリオ・画面のどれも気づきません。条件そのものが正しいかを確かめ、正しければ、その意図を不変条件かシナリオに書いてください。";
