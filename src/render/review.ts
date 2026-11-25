import type { Spec } from "../load.ts";
import type { EnsureCheck, Graph } from "../model.ts";
import { describeEnsure } from "./ensures.ts";

export interface ReviewItem {
  readonly id: string;
  readonly message: string;
}

export const unguardedId = (e: Pick<EnsureCheck, "action" | "reason">): string => `unguarded:${e.action}:${e.reason}`;

export const REVIEW_TITLE = "確かめてほしい点";
export const REVIEW_LEAD =
  "spec を実行した結果から、条件の書き忘れ・書き間違いの候補を挙げています。直すか、意図どおりなら `export const reviewed = { \"ID\": \"理由\" }` に書いてください。";

// 確認済みのものを消さずに残す理由: 「意図どおり」と判断した中身を、後から人が読めるようにするため。
export const reviewItems = (spec: Spec, graph: Graph) => {
  const items: Array<ReviewItem> = [
    ...(graph.ensures ?? [])
      .filter((e) => e.verdict === "unguarded")
      .map((e) => ({ id: unguardedId(e), message: `\`${e.action}\` の${describeEnsure(e).replace(/^⚠ /, "")}` })),
    ...(graph.omissions ?? []).map((h) => ({ id: h.id, message: h.message })),
  ];
  return {
    pending: items.filter((i) => spec.reviewed[i.id] === undefined),
    acknowledged: items.flatMap((i) => (spec.reviewed[i.id] === undefined ? [] : [{ ...i, note: spec.reviewed[i.id]! }])),
  };
};
