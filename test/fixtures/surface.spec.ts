import { ensure, ui } from "../../src/index.ts";

type Doc = { status: "draft" | "published" };
type User = { role: "editor" | "viewer" };

export const initial: Doc = { status: "draft" };
export const actors: Record<string, User> = { editor: { role: "editor" }, viewer: { role: "viewer" } };

export function publish(doc: Doc, user: User): Doc {
  ensure(user.role === "editor", "編集者だけ");
  ensure(doc.status === "draft", "下書きのときだけ");
  return { ...doc, status: "published" };
}

// viewer にも公開ボタンを見せている（押しても実行できない）
export function surface(doc: Doc, _user: User) {
  return ui.screen(
    "記事",
    ui.badge(doc.status),
    doc.status === "draft" ? ui.button("公開する", publish) : ui.text("公開済みです"),
  );
}
