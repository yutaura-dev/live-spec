import { ensure, ui } from "../src/index.ts";

/** ブログ記事。著者が書き、編集者がレビューして公開する。 */
export type Article = { status: "draft" | "inReview" | "published"; authorId: string };
type User = { id: string; role: "author" | "editor" | "admin" };

export const initial: Article = { status: "draft", authorId: "alice" };

export const actors: Record<string, User> = {
  著者alice: { id: "alice", role: "author" },
  別の著者bob: { id: "bob", role: "author" },
  編集者eve: { id: "eve", role: "editor" },
  管理者root: { id: "root", role: "admin" },
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

/** 記事の詳細画面 */
export function surface(article: Article, user: User) {
  const isAuthor = user.id === article.authorId;
  return ui.screen(
    "記事の詳細",
    ui.badge(article.status),
    isAuthor && article.status === "draft" && ui.button("レビューに出す", submit),
    user.role !== "author" && article.status === "inReview" && ui.button("公開する", publish),
  );
}
