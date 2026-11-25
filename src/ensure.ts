export class NotAllowed extends Error {
  readonly _tag = "NotAllowed";
}

// 外す ensure を globalThis に Symbol.for で置く理由: spec ファイルと live-spec 本体が別々に読み込まれて
// このモジュールが 2 つ存在する場合でも、同じ設定を見られるようにするため（isNotAllowed を _tag で判定するのと同じ事情）。
const BYPASS = Symbol.for("live-spec.ensure.bypass");
type BypassHolder = { [BYPASS]?: string };

export function ensure(condition: unknown, reason: string): asserts condition {
  if (condition) return;
  if ((globalThis as BypassHolder)[BYPASS] === reason) return;
  throw new NotAllowed(reason);
}

/** fn を実行している間だけ、理由が reason の ensure を素通りさせる（ミューテーションで使う） */
export const withEnsureBypassed = <A>(reason: string, fn: () => A): A => {
  const holder = globalThis as BypassHolder;
  const previous = holder[BYPASS];
  holder[BYPASS] = reason;
  try {
    return fn();
  } finally {
    if (previous === undefined) delete holder[BYPASS];
    else holder[BYPASS] = previous;
  }
};

// instanceof ではなく _tag で判定する理由: spec ファイルと live-spec 本体が別々に
// 読み込まれて NotAllowed クラスが 2 つ存在する場合でも、正しく判定できるようにするため。
export const isNotAllowed = (u: unknown): u is NotAllowed =>
  u instanceof Error && (u as { _tag?: unknown })._tag === "NotAllowed";
