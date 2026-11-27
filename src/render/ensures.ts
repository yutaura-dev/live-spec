import type { EnsureCheck } from "../model.ts";

const effectText = (e: EnsureCheck): string | null => {
  const first = e.effects[0];
  if (first === undefined) return e.newStates.length === 0 ? null : `状態「${e.newStates.join("」「")}」に入れるようになる`;
  const who = first.input === null ? first.actor : `${first.actor}（${first.input}）`;
  const rest = e.effects.length > 1 ? ` ほか ${e.effects.length - 1} 件` : "";
  return `${who} が ${first.state} で実行できるようになる（${first.after.replace(/^✅ /, "")}）${rest}`;
};

// 「外すと〜が気づく」のような検査の仕組みの言葉で書かない理由: 仕様書の読み手はコードを読まない人も含み、
// 知りたいのは「この条件がないと何が起きるか」という振る舞いのほうだから。検査に使ったものは括弧で添える。
const effectOf = (e: EnsureCheck, acknowledged: boolean): string => {
  switch (e.verdict) {
    case "caught": {
      const effect = effectText(e);
      const by = `${e.caughtBy.join("・")}で確かめている`;
      return effect === null ? `この条件は${by}` : `この条件がないと、${effect}（${by}）`;
    }
    case "unguarded":
      return `この条件がないと、${effectText(e) ?? "振る舞いが変わる"}。それを確かめている不変条件・シナリオ・画面がない${acknowledged ? "（確認済み）" : ""}`;
    case "no-effect":
      return e.narrowing ? "この条件がなくても振る舞いは変わらない（後の条件のために型を絞る条件）" : "この条件がなくても振る舞いは変わらない（ほかの条件と重なっている）";
  }
};

export interface EnsureParts {
  /** 理由の文と、実際に通るとき */
  readonly head: string;
  /** この条件がないと何が起きるか */
  readonly effect: string;
  /** 確かめるもののない条件で、読み手に見直してほしいもの */
  readonly warn: boolean;
}

// 理由の文と「実際に通るとき」を並べる理由: 理由の文は書き手の意図をもう一度書いたものなので、
// 実行して求めた事実と見比べると、状態の取り違えのような書き間違いが見える。
export const ensureParts = (e: EnsureCheck, acknowledged = false): EnsureParts => ({
  head: `「${e.reason}」— 通るのは ${e.passes}`,
  effect: effectOf(e, acknowledged),
  warn: e.verdict === "unguarded" && !acknowledged,
});

export const describeEnsure = (e: EnsureCheck, acknowledged = false): string => {
  const p = ensureParts(e, acknowledged);
  return `${p.warn ? "⚠ " : ""}${p.head}。${p.effect}`;
};
