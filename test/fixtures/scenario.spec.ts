import { ensure } from "../../src/index.ts";

type Doc = { status: "draft" | "inReview" | "published" };
type User = { role: "author" | "editor" };

export const initial: Doc = { status: "draft" };
export const actors: Record<string, User> = { author: { role: "author" }, editor: { role: "editor" } };

export const inputs = {
  reject: { 理由あり: ["誤字"], 理由なし: [""] },
};

/** レビューに出す */
export function submit(d: Doc, u: User): Doc {
  ensure(u.role === "author", "著者だけ");
  ensure(d.status === "draft", "下書きのときだけ");
  return { ...d, status: "inReview" };
}

/** 差し戻す */
export function reject(d: Doc, u: User, comment: string): Doc {
  ensure(u.role === "editor", "編集者だけ");
  ensure(d.status === "inReview", "レビュー中のときだけ");
  ensure(comment !== "", "差し戻し理由が必要");
  return { ...d, status: "draft" };
}

/** 公開する */
export function publish(d: Doc, u: User): Doc {
  ensure(u.role === "editor", "編集者だけ");
  ensure(d.status === "inReview", "レビュー中のときだけ");
  return { ...d, status: "published" };
}

export const scenarios = {
  書いて公開するまで: [
    { do: submit, by: "author" },
    { do: publish, by: "editor", expect: { status: "published" } },
  ],
  差し戻されて出し直す: [
    { do: submit, by: "author" },
    { do: reject, by: "editor", input: "理由あり" },
    { do: submit, by: "author", expect: { status: "inReview" } },
  ],
};
