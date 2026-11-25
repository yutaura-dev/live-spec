import { ensure } from "../../src/index.ts";

/** ブログ記事 */
export type Article = {
  status: "draft" | "inReview" | "published" | "archived";
  pinned: boolean;
  authorId: string;
};
type User = { id: string; role: "author" | "editor" | "admin" };

export const initial: Article = { status: "draft", pinned: false, authorId: "alice" };

export const actors: Record<string, User> = {
  alice: { id: "alice", role: "author" },
  bob: { id: "bob", role: "author" },
  editor: { id: "eve", role: "editor" },
  admin: { id: "root", role: "admin" },
};

/** レビューに出す */
export function submit(article: Article, user: User): Article {
  ensure(user.id === article.authorId, "自分の記事だけ");
  ensure(article.status === "draft", "下書きのときだけ");
  return { ...article, status: "inReview" };
}

/** 公開する */
export function publish(article: Article, user: User): Article {
  ensure(user.role === "editor" || user.role === "admin", "編集者か管理者だけ");
  ensure(article.status === "inReview", "レビュー中のときだけ");
  return { ...article, status: "published" };
}

export function pin(article: Article, user: User): Article {
  ensure(user.role === "editor", "編集者だけ");
  ensure(article.status === "published", "公開中のときだけ");
  ensure(!article.pinned, "まだ固定していないときだけ");
  return { ...article, pinned: true };
}

/** アーカイブする */
export function archive(article: Article, user: User): Article {
  ensure(user.role === "admin", "管理者だけ");
  ensure(article.status === "published", "公開中のときだけ");
  return { ...article, status: "archived", pinned: false };
}
