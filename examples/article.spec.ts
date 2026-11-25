import { ensure } from "../src/index.ts";

/** ブログ記事。著者が書き、編集者がレビューして公開する。 */
export type Article = {
  status: "draft" | "inReview" | "published" | "archived";
  pinned: boolean;
  authorId: string;
};

type User = { id: string; role: "author" | "editor" | "admin" };

export const initial: Article = { status: "draft", pinned: false, authorId: "alice" };

export const actors: Record<string, User> = {
  著者alice: { id: "alice", role: "author" },
  別の著者bob: { id: "bob", role: "author" },
  編集者eve: { id: "eve", role: "editor" },
  管理者root: { id: "root", role: "admin" },
};

/** 本文を編集する */
export function edit(article: Article, user: User): Article {
  ensure(user.id === article.authorId, "自分の記事だけ");
  ensure(article.status === "draft", "下書きのときだけ");
  return article;
}

/** レビューに出す */
export function submit(article: Article, user: User): Article {
  ensure(user.id === article.authorId, "自分の記事だけ");
  ensure(article.status === "draft", "下書きのときだけ");
  return { ...article, status: "inReview" };
}

/** 差し戻す */
export function reject(article: Article, user: User): Article {
  ensure(user.role === "editor", "編集者だけ");
  ensure(article.status === "inReview", "レビュー中のときだけ");
  return { ...article, status: "draft" };
}

/** 公開する */
export function publish(article: Article, user: User): Article {
  ensure(user.role === "editor" || user.role === "admin", "編集者か管理者だけ");
  ensure(article.status === "inReview", "レビュー中のときだけ");
  return { ...article, status: "published" };
}

/** トップに固定する */
export function pin(article: Article, user: User): Article {
  ensure(user.role === "editor", "編集者だけ");
  ensure(article.status === "published", "公開中のときだけ");
  ensure(!article.pinned, "まだ固定していないときだけ");
  return { ...article, pinned: true };
}

/** 公開を取り下げて下書きに戻す */
export function unpublish(article: Article, user: User): Article {
  ensure(user.role === "admin", "管理者だけ");
  ensure(article.status === "published", "公開中のときだけ");
  return { ...article, status: "draft" };
}

/** アーカイブする */
export function archive(article: Article, user: User): Article {
  ensure(user.role === "admin", "管理者だけ");
  ensure(article.status === "published", "公開中のときだけ");
  return { ...article, status: "archived", pinned: false };
}
