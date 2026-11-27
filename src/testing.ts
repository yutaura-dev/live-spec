type ActionFn = (...args: never[]) => unknown;
type SpecModule = { readonly scenarios?: unknown; readonly invariants?: unknown };
type ModuleItem = { readonly scenario: string } | { readonly invariant: string };

const hasKey = (record: unknown, key: string) => typeof record === "object" && record !== null && Object.hasOwn(record, key);

// テストの名前を作るだけの関数にしている理由: vitest・@effect/vitest・jest・playwright のどれの describe / it にも
// 渡せるようにするため。テストと spec の項目を結ぶのは、live-spec check --tests がテストのファイルを静的に読んで行う。
// spec にない項目を渡したときにここで失敗させるのは、テストを定義した時点（テストを走らせる前）に気づけるようにするため。
export function specOf(action: ActionFn, reason?: string): string;
export function specOf(spec: SpecModule, item: ModuleItem): string;
export function specOf(target: ActionFn | SpecModule, item?: string | ModuleItem): string {
  if (typeof target === "function") {
    if (item === undefined) return target.name;
    const reason = item as string;
    if (!target.toString().includes(reason)) throw new Error(`specOf: ${target.name} に「${reason}」という条件がない`);
    return `${target.name}「${reason}」`;
  }
  const m = item as ModuleItem;
  if ("scenario" in m) {
    if (!hasKey(target.scenarios, m.scenario)) throw new Error(`specOf: シナリオ「${m.scenario}」がない`);
    return `シナリオ「${m.scenario}」`;
  }
  if (!hasKey(target.invariants, m.invariant)) throw new Error(`specOf: 不変条件「${m.invariant}」がない`);
  return `不変条件「${m.invariant}」`;
}
