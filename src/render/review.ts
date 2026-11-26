import type { Spec } from "../load.ts";
import type { EnsureCheck, Graph } from "../model.ts";
import { describeEnsure } from "./ensures.ts";

export interface ReviewItem {
  readonly id: string;
  readonly message: string;
  /** 対象の操作（未決事項の about と照らすのに使う） */
  readonly action: string | null;
  /** 対象の状態の id（未決事項の about と照らすのに使う） */
  readonly state: string | null;
}

export const unguardedId = (e: Pick<EnsureCheck, "action" | "reason">): string => `unguarded:${e.action}:${e.reason}`;

/** テストのない条件の ID の頭。テストを結んだとき（live-spec check --tests）にだけ出る */
export const UNTESTED = "untested:";

export const REVIEW_TITLE = "確かめてほしい点";
export const REVIEW_LEAD =
  "spec を実行した結果から、条件の書き忘れ・書き間違いの候補を挙げています。直すか、意図どおりなら `export const reviewed = { \"ID\": \"理由\" }` に書いてください。";

// 確認済みのものを消さずに残す理由: 「意図どおり」と判断した中身を、後から人が読めるようにするため。
export const reviewItems = (spec: Spec, graph: Graph) => {
  const items: Array<ReviewItem> = [
    ...(graph.ensures ?? [])
      .filter((e) => e.verdict === "unguarded")
      .map((e) => ({ id: unguardedId(e), message: `\`${e.action}\` の${describeEnsure(e).replace(/^⚠ /, "")}`, action: e.action, state: null })),
    ...(graph.omissions ?? []).map((h) => ({ id: h.id, message: h.message, action: h.action, state: h.state ?? null })),
  ];
  // 未決事項が指している候補を「判断待ち」に分ける理由: 判断がつくまでは意図どおりとも言えず（reviewed には書けない）、
  // かといって残すと check が失敗し続ける。未決事項は人の判断待ちの正常な状態なので、その候補も同じ扱いにする。
  const questionOf = (i: ReviewItem) =>
    graph.questions.findIndex((q) => (i.action !== null && q.action === i.action) || (i.state !== null && q.states.includes(i.state)));
  const open = items.filter((i) => spec.reviewed[i.id] === undefined);
  return {
    pending: open.filter((i) => questionOf(i) === -1),
    onHold: open.flatMap((i) => {
      const q = questionOf(i);
      return q === -1 ? [] : [{ ...i, question: q + 1, ask: graph.questions[q]!.ask }];
    }),
    acknowledged: items.flatMap((i) => (spec.reviewed[i.id] === undefined ? [] : [{ ...i, note: spec.reviewed[i.id]! }])),
  };
};
