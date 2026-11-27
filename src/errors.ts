/** live-spec 自身の不具合で落ちたときに、メッセージに添える文 */
export const BUG_REPORT =
  "live-spec の不具合です。spec ファイルと、このメッセージ（スタックトレースを含む）を添えて、https://github.com/yutaura-dev/live-spec/issues に報告してください";

/** live-spec が利用者に向けて出す、予期した失敗（spec の書き方の誤りなど）。スタックトレースを出さない */
export class SpecError extends Error {
  override name = "SpecError";
}

const headOf = (e: unknown): string => (e instanceof Error ? `${e.name}: ${e.message}` : String(e));

// スタックの先頭の行は「名前: メッセージ」なので、それを除いた呼び出しの行だけを返す。メッセージは別に出すため。
const framesOf = (e: Error): string | null => {
  const lines = (e.stack ?? "").split("\n");
  const first = lines.findIndex((l) => /^\s+at /.test(l));
  return first === -1 ? null : lines.slice(first).join("\n");
};

/** 予期しない例外のスタックトレース（cause も含む）。予期した失敗では null */
export const stackOf = (e: unknown): string | null => {
  if (!(e instanceof Error) || e instanceof SpecError) return null;
  const parts: Array<string> = [];
  for (let cur: unknown = e, depth = 0; cur instanceof Error && depth < 5; cur = cur.cause, depth++) {
    const frames = framesOf(cur);
    parts.push(`${depth === 0 ? "" : `原因: ${headOf(cur)}\n`}${frames ?? ""}`);
  }
  return parts.join("\n");
};

/** 利用者に出すエラーの文。予期しない例外では、メッセージに続けてスタックトレースを出す */
export const describeError = (e: unknown): string => {
  if (e instanceof SpecError) return e.message;
  const stack = stackOf(e);
  return stack === null ? headOf(e) : `${headOf(e)}\n${stack}`;
};

// 構文の誤りは spec の書き方の誤りなので、予期した失敗として短く出す。スタックは変換器の中を指すだけで、
// 誤りの場所はメッセージに入っているため。spec を実行して投げた例外は、スタックが spec の行を指すので、そのまま出す。
const isSyntaxError = (e: unknown): e is Error =>
  e instanceof Error &&
  (e instanceof SyntaxError || (e as { code?: unknown }).code === "ERR_INVALID_TYPESCRIPT_SYNTAX" || e.message.startsWith("Transform failed"));

/** spec・値オブジェクト・集約のファイルを読み込む。構文の誤りは SpecError にする */
export const importSource = async (href: string): Promise<Record<string, unknown>> => {
  try {
    return (await import(href)) as Record<string, unknown>;
  } catch (e) {
    if (isSyntaxError(e)) throw new SpecError(e.message, { cause: e });
    throw e;
  }
};
