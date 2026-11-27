import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadObject, resolveLinks } from "../src/generate.ts";
import { projectRelations } from "../src/relations.ts";
import { renderProjectHtml } from "../src/render/html.ts";
import { renderIndexMarkdown } from "../src/render/markdown.ts";
import { analyze } from "../src/static.ts";

const INDEX = new URL("../src/index.ts", import.meta.url).pathname;

const POST = `import { ensure } from "${INDEX}";
import type { User } from "./user.spec.ts";
/** 記事 */
export type Post = { status: "draft" | "published"; author: User; editor?: User | null };
export const initial: Post = { status: "draft", author: { status: "active", posts: [] }, editor: null };
export const actors = { 人: {} };
/** 公開する */
export function publish(p: Post): Post { ensure(p.status === "draft", "下書きのときだけ"); return { ...p, status: "published" }; }
`;

const USER = `import { ensure } from "${INDEX}";
import type { Post } from "./post.spec.ts";
/** 利用者 */
export type User = { status: "active" | "banned"; posts: Array<Post> };
export const initial: User = { status: "active", posts: [] };
export const actors = { 管理者: {} };
/** 止める */
export function ban(u: User): User { ensure(u.status === "active", "使えるときだけ"); return { ...u, status: "banned" }; }
`;

const COMMENT = `import { ensure } from "${INDEX}";
/** コメント */
export type Comment = {
  status: "open" | "hidden";
  /** 書いた記事 @ref post */
  postId: string;
  /** @ref none */
  author: string;
  /** @ref 存在しない */
  threadId: string;
};
export const initial: Comment = { status: "open", postId: "p1", author: "a", threadId: "t1" };
export const actors = { 人: {} };
/** 隠す */
export function hide(c: Comment): Comment { ensure(c.status === "open", "公開中のときだけ"); return { ...c, status: "hidden" }; }
`;

const project = async () => {
  const dir = mkdtempSync(join(tmpdir(), "live-spec-rel-"));
  writeFileSync(join(dir, "post.spec.ts"), POST);
  writeFileSync(join(dir, "user.spec.ts"), USER);
  writeFileSync(join(dir, "comment.spec.ts"), COMMENT);
  return resolveLinks(await Promise.all(["post", "user", "comment"].map((n) => loadObject(join(dir, `${n}.spec.ts`)))));
};

describe("ドメインオブジェクトの関連: 状態の型の項目から読む", { timeout: 60_000 }, () => {
  it("項目の型がほかの型なら 1 つ、配列なら複数、? や null があれば無くてもよい関連として読む", () => {
    expect(analyze(POST).refs).toEqual([
      { field: "author", target: "User", many: false, optional: false, explicit: false },
      { field: "editor", target: "User", many: false, optional: true, explicit: false },
    ]);
    expect(analyze(USER).refs).toEqual([{ field: "posts", target: "Post", many: true, optional: false, explicit: false }]);
  });

  it("JSDoc の @ref で、型から分からない項目の相手を指し、@ref none で関連から外す", () => {
    expect(analyze(COMMENT).refs).toEqual([
      { field: "postId", target: "post", many: false, optional: false, explicit: true },
      { field: "threadId", target: "存在しない", many: false, optional: false, explicit: true },
    ]);
  });

  it("相手の spec を、spec の名前か状態の型の名前で探し、互いを指す 2 本は 1 本にまとめる", async () => {
    const relations = projectRelations(await project());

    expect(relations).toContainEqual({ from: "post", to: "user", fields: ["author", "editor"], back: ["posts"], fromMany: true, toMany: false });
    expect(relations).toContainEqual({ from: "comment", to: "post", fields: ["postId"], back: [], fromMany: null, toMany: false });
    expect(relations).toHaveLength(2);
  });

  it("@ref で指した相手が見つからなければ、検査結果に出す", async () => {
    const comment = (await project()).find((o) => o.spec.name === "comment")!;

    expect(comment.graph.findings).toContainEqual({ kind: "ref-unresolved", field: "threadId", target: "存在しない" });
  });

  it("関連の項目は、どの操作の可否も変えなくても「確かめてほしい点」に出さない（データの構造を表す項目なので）", async () => {
    const objects = await project();

    const ids = objects.flatMap((o) => (o.graph.omissions ?? []).map((h) => h.id));

    // comment の author は @ref none で関連から外したが、どこからも読まれない string の項目なので、データの項目として候補に出ない。
    expect(ids.filter((id) => id.startsWith("unused-field:"))).toEqual([]);
  });

  it("一覧の Markdown に、mermaid の erDiagram で関連を出す", async () => {
    const md = renderIndexMarkdown(await project(), "記事");

    expect(md).toContain("## 関連");
    expect(md).toContain("erDiagram");
    expect(md).toContain('  e0["post"] {\n    enum status\n    ref author\n    ref editor\n  }');
    expect(md).toContain('  e0 }o--|| e1 : "author, editor / posts"');
    expect(md).toContain('  e2 }o--|| e0 : "postId"');
  });

  it("一覧の HTML に、関連の図を出し、線に項目の名前と数を添える", async () => {
    const html = await renderProjectHtml(await project(), { title: "記事" });

    expect(html).toContain("<h2>関連</h2>");
    expect(html).toContain("author, editor（1）／ posts（多）");
  });
});
