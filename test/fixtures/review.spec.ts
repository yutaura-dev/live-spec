import { ensure } from "../../src/index.ts";

type Doc = { status: "inReview" | "draft" | "published" };
type User = { role: "editor" | "author" };

export const initial: Doc = { status: "inReview" };
export const actors: Record<string, User> = { editor: { role: "editor" }, author: { role: "author" } };

export const inputs = {
  reject: { 理由あり: ["誤字があります"], 理由なし: [""] },
};

export function reject(doc: Doc, user: User, comment: string): Doc {
  ensure(user.role === "editor", "編集者だけ");
  ensure(doc.status === "inReview", "レビュー中のときだけ");
  ensure(comment.trim() !== "", "差し戻し理由が必要");
  return { ...doc, status: "draft" };
}

export function publish(doc: Doc, user: User): Doc {
  ensure(user.role === "editor", "編集者だけ");
  ensure(doc.status === "inReview", "レビュー中のときだけ");
  return { ...doc, status: "published" };
}
