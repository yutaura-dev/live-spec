import { ensure } from "../../src/index.ts";

type Article = { status: "draft" | "published"; pinned: boolean };
type User = { role: "editor" };

export const initial: Article = { status: "draft", pinned: false };
export const actors: Record<string, User> = { editor: { role: "editor" } };

export const invariants = {
  固定は公開中の記事だけ: (a: Article) => !a.pinned || a.status === "published",
};

export function publish(a: Article): Article {
  ensure(a.status === "draft", "下書きのときだけ");
  return { ...a, status: "published" };
}

export function pin(a: Article): Article {
  ensure(a.status === "published", "公開中のときだけ");
  ensure(!a.pinned, "まだ固定していないときだけ");
  return { ...a, pinned: true };
}

export function unpublish(a: Article): Article {
  ensure(a.status === "published", "公開中のときだけ");
  return { ...a, status: "draft" };
}
