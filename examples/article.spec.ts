import { ensure, ui } from "../src/index.ts";

/** ブログ記事。著者が書き、編集者がレビューして公開する。 */
export type Article = {
  /** 公開の段階 */
  status: "draft" | "inReview" | "published" | "archived";
  /** トップページに固定しているか */
  pinned: boolean;
  /** 著者のユーザー ID（「自分の記事だけ」の判定に使う） */
  authorId: string;
};

export const glossary = {
  draft: "著者が書いている途中。読者には見えない",
  inReview: "編集者のレビューを待っている",
  published: "読者に公開されている",
  archived: "公開を終えて保管している。読者には見えない",
  pinned: "トップページに固定されている",
};

type User = { id: string; role: "author" | "editor" | "admin" };

export const initial: Article = { status: "draft", pinned: false, authorId: "alice" };

export const invariants = {
  固定できるのは公開中の記事だけ: (a: Article) => !a.pinned || a.status === "published",
};

export const inputs = {
  reject: { 理由を書いた: ["見出しに誤字があります"], 理由が空: [""] },
};

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
export function reject(article: Article, user: User, comment: string): Article {
  ensure(user.role === "editor", "編集者だけ");
  ensure(article.status === "inReview", "レビュー中のときだけ");
  ensure(comment.trim() !== "", "差し戻し理由が必要");
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

export const scenarios = {
  書いて公開するまで: [
    { do: submit, by: "著者alice" },
    { do: publish, by: "編集者eve", expect: { status: "published" } },
  ],
  理由を書かずには差し戻せない: [
    { do: submit, by: "著者alice" },
    { do: reject, by: "編集者eve", input: "理由が空", denied: "差し戻し理由が必要" },
  ],
  差し戻されて書き直す: [
    { do: submit, by: "著者alice" },
    { do: reject, by: "編集者eve", input: "理由を書いた" },
    { do: edit, by: "著者alice" },
    { do: submit, by: "著者alice", expect: { status: "inReview" } },
  ],
  固定してからアーカイブする: [
    { do: submit, by: "著者alice" },
    { do: publish, by: "管理者root" },
    { do: pin, by: "編集者eve", expect: { pinned: true } },
    { do: archive, by: "管理者root", expect: { status: "archived", pinned: false } },
  ],
};

/** 記事の詳細画面。見る人の役割と記事の状態によって、出るボタンが変わる。 */
export function surface(article: Article, user: User) {
  const isAuthor = user.id === article.authorId;
  const { status } = article;
  return ui.screen(
    "記事の詳細",
    ui.section("状態", ui.badge(status), article.pinned && ui.badge("トップに固定中")),
    ui.field("タイトル", "はじめての live-spec"),
    ui.text("本文がここに入ります。"),
    ui.section(
      "操作",
      isAuthor && status === "draft" && ui.button("編集する", edit),
      isAuthor && status === "draft" && ui.button("レビューに出す", submit),
      user.role === "editor" && status === "inReview" && ui.button("差し戻す", reject),
      (user.role === "editor" || user.role === "admin") && status === "inReview" && ui.button("公開する", publish),
      user.role === "editor" && status === "published" && !article.pinned && ui.button("トップに固定する", pin),
      user.role === "admin" && status === "published" && ui.button("公開を取り下げる", unpublish),
      user.role === "admin" && status === "published" && ui.button("アーカイブする", archive),
    ),
  );
}
