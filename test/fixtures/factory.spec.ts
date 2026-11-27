import { ensure } from "../../src/index.ts";

/** 記事。著者が書き始めて、公開する。 */
export type Article = {
  /** 公開の段階 */
  status: "draft" | "published";
  /** 記事の種類（書き始めるときに決まる） */
  kind: "news" | "column";
  /** トップに載せているか */
  featured: boolean;
  /** 書いた著者 */
  authorId: string;
};

type User = { id: string; role: "author" | "reader" };

export const actors: Record<string, User> = {
  著者alice: { id: "alice", role: "author" },
  読者carol: { id: "carol", role: "reader" },
};

export const inputs = {
  initial: { ニュース: ["news", "速報"], コラム: ["column", "連載"], 題名が空: ["news", ""] },
};

/** 記事を書き始める */
export function initial(user: User, kind: Article["kind"], title: string): Article {
  ensure(user.role === "author", "著者だけ");
  ensure(title.trim() !== "", "題名が必要");
  return { status: "draft", kind, featured: false, authorId: user.id };
}

/** 公開する */
export function publish(article: Article, user: User): Article {
  ensure(user.id === article.authorId, "自分の記事だけ");
  ensure(article.status === "draft", "下書きのときだけ");
  return { ...article, status: "published" };
}

/** トップに載せる */
export function feature(article: Article, user: User): Article {
  ensure(user.id === article.authorId, "自分の記事だけ");
  ensure(article.kind === "news", "ニュースだけ");
  ensure(article.status === "published", "公開中のときだけ");
  ensure(!article.featured, "まだ載せていないときだけ");
  return { ...article, featured: true };
}

export const scenarios = {
  書き始めて公開する: [
    { do: initial, by: "著者alice", input: "ニュース" },
    { do: publish, by: "著者alice", expect: { status: "published" } },
  ],
  読者は書き始められない: [{ do: initial, by: "読者carol", input: "ニュース", denied: "著者だけ" }],
};
