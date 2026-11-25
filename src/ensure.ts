export class NotAllowed extends Error {
  readonly _tag = "NotAllowed";
}

// 外す ensure を globalThis に Symbol.for で置く理由: spec ファイルと live-spec 本体が別々に読み込まれて
// このモジュールが 2 つ存在する場合でも、同じ設定を見られるようにするため（isNotAllowed を _tag で判定するのと同じ事情）。
const BYPASS = Symbol.for("live-spec.ensure.bypass");
interface BypassMode {
  /** skip: 理由が reason の ensure だけを素通りさせる。only: 理由が reason の ensure だけを効かせる */
  readonly mode: "skip" | "only";
  readonly reason: string;
}
type BypassHolder = { [BYPASS]?: BypassMode };

export function ensure(condition: unknown, reason: string): asserts condition {
  if (condition) return;
  const bypass = (globalThis as BypassHolder)[BYPASS];
  if (bypass !== undefined && (bypass.mode === "skip" ? bypass.reason === reason : bypass.reason !== reason)) return;
  throw new NotAllowed(reason);
}

const withBypass = <A>(mode: BypassMode, fn: () => A): A => {
  const holder = globalThis as BypassHolder;
  const previous = holder[BYPASS];
  holder[BYPASS] = mode;
  try {
    return fn();
  } finally {
    if (previous === undefined) delete holder[BYPASS];
    else holder[BYPASS] = previous;
  }
};

/** fn を実行している間だけ、理由が reason の ensure を素通りさせる（ミューテーションで使う） */
export const withEnsureBypassed = <A>(reason: string, fn: () => A): A => withBypass({ mode: "skip", reason }, fn);

/** fn を実行している間だけ、理由が reason の ensure 以外を素通りさせる（その ensure が実際に止める範囲を求めるのに使う） */
export const withOnlyEnsure = <A>(reason: string, fn: () => A): A => withBypass({ mode: "only", reason }, fn);

// instanceof ではなく _tag で判定する理由: spec ファイルと live-spec 本体が別々に
// 読み込まれて NotAllowed クラスが 2 つ存在する場合でも、正しく判定できるようにするため。
export const isNotAllowed = (u: unknown): u is NotAllowed =>
  u instanceof Error && (u as { _tag?: unknown })._tag === "NotAllowed";
