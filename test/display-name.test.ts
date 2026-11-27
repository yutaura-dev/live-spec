import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadObject, resolveLinks } from "../src/generate.ts";
import { renderProjectHtml } from "../src/render/html.ts";
import { renderIndexMarkdown, renderMarkdown } from "../src/render/markdown.ts";

const INDEX = new URL("../src/index.ts", import.meta.url).pathname;

const spec = (extra = "") => `import { ensure } from "${INDEX}";
export type S = { status: "open" | "done" };
export const initial: S = { status: "open" };
export const actors = { 人: {} };
/** 終える */
export function finish(s: S): S { ensure(s.status === "open", "開いているときだけ"); return { status: "done" }; }
${extra}
`;

const project = async () => {
  const dir = mkdtempSync(join(tmpdir(), "live-spec-name-"));
  writeFileSync(join(dir, "action-item.spec.ts"), spec('export const links = [{ from: finish, to: "pull-request", label: "終えたら PR を出す" }];'));
  writeFileSync(join(dir, "pull-request.spec.ts"), spec('export const displayName = "PR";'));
  return resolveLinks(await Promise.all(["action-item", "pull-request"].map((n) => loadObject(join(dir, `${n}.spec.ts`)))));
};

describe("ドメインオブジェクトの表示名", { timeout: 60_000 }, () => {
  it("ファイル名のケバブケースから Title Case の表示名を作り、displayName で上書きできる", async () => {
    const [item, pr] = await project();

    expect(item!.spec.displayName).toBe("Action Item");
    expect(pr!.spec.displayName).toBe("PR");
  });

  it("Markdown の見出しと一覧には表示名を出し、リンク先はファイル名のまま", async () => {
    const objects = await project();

    expect(renderMarkdown(objects[0]!.spec, objects[0]!.graph, objects)).toMatch(/^# Action Item\n/);
    expect(renderIndexMarkdown(objects, "仕様")).toContain("| [Action Item](action-item.md) |");
  });

  it("HTML の見出し・タブ・一覧のカード・つながりのリンクには表示名を出し、URL はファイル名のまま", async () => {
    const html = await renderProjectHtml(await project(), { title: "仕様" });

    expect(html).toContain('<a href="#/action-item" data-tab="action-item">Action Item</a>');
    expect(html).toContain("<h1>Action Item</h1>");
    expect(html).toContain('<a href="#/pull-request">PR</a>');
  });

  it("線と状態のパネルの見出しにも、ファイル名ではなく表示名を出す", async () => {
    const html = await renderProjectHtml(await project(), { title: "仕様" });

    expect(html).toContain('"displayName":"PR"');
    expect(html).toContain('pageTitle() + " の線"');
    expect(html).toContain('pageTitle() + " の状態"');
    expect(html).not.toContain('current.name + " の線"');
  });
});
