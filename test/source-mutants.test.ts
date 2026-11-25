import { describe, expect, it } from "vitest";
import { sourceMutants } from "../scripts/lib/source-mutants.ts";

const SOURCE = `import { ensure } from "live-spec";
export type Doc = { status: "draft" | "published" | "archived"; locked: boolean; count: number };
type User = { role: string };
export function publish(d: Doc, u: User): Doc {
  ensure(u.role === "editor" || u.role === "admin", "編集者か管理者だけ");
  ensure(d.status === "draft" && !d.locked, "未ロックの下書きだけ");
  ensure(d.count < 3, "3 回まで");
  return d;
}
`;

const fields = { status: ["draft", "published", "archived"], locked: [false, true] };

describe("ensure の条件を部分的に壊した spec のソースを作る（書き忘れ・書き間違いの再現）", () => {
  const mutants = sourceMutants(SOURCE, fields);
  const conditions = (operator: string) => mutants.filter((m) => m.operator === operator).map((m) => m.condition);

  it("ensure を丸ごと外す", () => {
    expect(conditions("remove")).toEqual(["true", "true", "true"]);
  });

  it("|| の片側を消す（「編集者か管理者だけ」が「編集者だけ」になる）", () => {
    expect(conditions("drop-disjunct")).toEqual(['u.role === "admin"', 'u.role === "editor"']);
  });

  it("&& の片側を消す", () => {
    expect(conditions("drop-conjunct")).toEqual(["!d.locked", 'd.status === "draft"']);
  });

  it("=== と !== を入れ替える", () => {
    expect(conditions("flip-equality")).toContain('u.role !== "editor" || u.role === "admin"');
  });

  it("境目をずらす", () => {
    expect(conditions("boundary")).toEqual(["d.count <= 3"]);
  });

  it("状態の項目と比べている値を、同じ項目の別の値に差し替える", () => {
    expect(conditions("swap-value")).toEqual(['d.status === "published" && !d.locked', 'd.status === "archived" && !d.locked']);
  });

  it("書き換えたソースには、元の ensure の理由と書き換えた条件が入っている", () => {
    const m = mutants.find((x) => x.operator === "boundary")!;

    expect(m.action).toBe("publish");
    expect(m.reason).toBe("3 回まで");
    expect(m.source).toContain('ensure(d.count <= 3, "3 回まで")');
  });
});
