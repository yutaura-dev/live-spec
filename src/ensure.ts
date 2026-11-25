export class NotAllowed extends Error {
  readonly _tag = "NotAllowed";
}

export function ensure(condition: unknown, reason: string): asserts condition {
  if (!condition) throw new NotAllowed(reason);
}

// instanceof ではなく _tag で判定する理由: spec ファイルと live-spec 本体が別々に
// 読み込まれて NotAllowed クラスが 2 つ存在する場合でも、正しく判定できるようにするため。
export const isNotAllowed = (u: unknown): u is NotAllowed =>
  u instanceof Error && (u as { _tag?: unknown })._tag === "NotAllowed";
