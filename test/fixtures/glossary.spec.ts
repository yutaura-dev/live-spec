import { ensure } from "../../src/index.ts";

/** 記事 */
export type Article = {
  /** 公開の段階 */
  status: "draft" | "inReview" | "published";
  /** 著者のユーザー ID */
  authorId: string;
};
type User = { id: string; role: "author" | "editor" };

export const initial: Article = { status: "draft", authorId: "alice" };
export const actors: Record<string, User> = { alice: { id: "alice", role: "author" }, eve: { id: "eve", role: "editor" } };

export const glossary = {
  draft: "著者が書いている途中。読者には見えない",
  inReview: "編集者のレビューを待っている",
  published: "読者に公開されている",
};

/** レビューに出す */
export function submit(a: Article, u: User): Article {
  ensure(u.id === a.authorId, "自分の記事だけ");
  ensure(a.status === "draft", "下書きのときだけ");
  return { ...a, status: "inReview" };
}

/** 公開する */
export function publish(a: Article, u: User): Article {
  ensure(u.role === "editor", "編集者だけ");
  ensure(a.status === "inReview", "レビュー中のときだけ");
  return { ...a, status: "published" };
}
