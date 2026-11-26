import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ensure } from "../src/ensure.ts";
import { explore } from "../src/explore.ts";
import { loadObject } from "../src/generate.ts";
import { loadSpec } from "../src/load.ts";
import { findOmissionHints } from "../src/omission.ts";
import { renderHtml } from "../src/render/html.ts";
import { renderMarkdown } from "../src/render/markdown.ts";

const INDEX = new URL("../src/index.ts", import.meta.url).pathname;

const SOURCE = `import { ensure } from "${INDEX}";
/** 実行 */
export type Run = {
  /** 実行の状態。待機中から始まる */
  status: "待機中" | "実行中" | "完了";
};
export const initial: Run = { status: "待機中" };
export const actors = { ワーカー: {} };
/** 実行を始める。 */
export function start(r: Run): Run {
  ensure(r.status === "待機中", "待機中のときだけ");
  return { ...r, status: "実行中" };
}
/** 実行を終える */
export function finish(r: Run): Run {
  ensure(r.status === "実行中", "実行中のときだけ");
  return { ...r, status: "完了" };
}
`;

const load = async () => {
  const dir = mkdtempSync(join(tmpdir(), "live-spec-labels-"));
  writeFileSync(join(dir, "run.spec.ts"), SOURCE);
  return loadObject(join(dir, "run.spec.ts"));
};

describe("仕様書の読みやすさ: 型の識別子の代わりに JSDoc の名前を出す", { timeout: 30_000 }, () => {
  it("条件の「通るのは」に、項目名ではなく項目の JSDoc の最初の文を出す", async () => {
    const { spec, graph } = await load();

    const md = renderMarkdown(spec, graph);

    expect(md).toContain("「待機中のときだけ」— 通るのは 実行の状態 が 待機中 のとき");
    expect(md).not.toContain("通るのは status が");
  });

  it("操作の結果に、項目名ではなく項目の JSDoc の最初の文を出す", async () => {
    const { spec, graph } = await load();

    const md = renderMarkdown(spec, graph);
    const html = await renderHtml(spec, graph);

    expect(md).toContain("- **結果**: 実行の状態 → 実行中");
    expect(html).toContain("<dt>結果</dt><dd>実行の状態 → 実行中</dd>");
  });

  it("状態遷移図の矢印には、関数名ではなく操作の JSDoc の最初の文を出す", async () => {
    const { spec, graph } = await load();

    const md = renderMarkdown(spec, graph);
    const html = await renderHtml(spec, graph);

    expect(md).toMatch(/--> \w+: 実行を始める \(ワーカー\)/);
    expect(md).not.toMatch(/--> \w+: start /);
    expect(html).toContain(">実行を始める</text>");
  });

  it("操作の見出しは JSDoc の要約だけにし、関数名は「関数名」の欄に出す", async () => {
    const { spec, graph } = await load();

    const md = renderMarkdown(spec, graph);
    const html = await renderHtml(spec, graph);

    expect(md).toContain("### 実行を始める。\n");
    expect(md).toContain("- **関数名**: `start`");
    expect(html).toMatch(/<h3>実行を始める。<\/h3>/);
    expect(html).toContain("<dt>関数名</dt><dd><code>start</code></dd>");
  });
});

describe("仕様書の読みやすさ: 節の名前に、何のための節かを一言添える", { timeout: 30_000 }, () => {
  it("Markdown の節の見出しの下に、その節の説明を 1 行置く", async () => {
    const { spec, graph } = await load();

    const md = renderMarkdown(spec, graph);

    expect(md).toContain("## 状態遷移図\n\n初期状態から操作を実行して求めた、取りうる状態とその移り変わり。\n");
    expect(md).toContain("## 操作\n\n操作ごとに、誰が・どの状態でできるか、できないときの理由。\n");
    expect(md).toContain("## 検査結果\n\nspec を実行して見つかった、矛盾や書き漏れ。\n");
  });

  it("HTML の節の見出しの下にも、その節の説明を置く", async () => {
    const { spec, graph } = await load();

    const html = await renderHtml(spec, graph);

    expect(html).toContain('<h2>操作</h2><p class="section-lead">操作ごとに、誰が・どの状態でできるか、できないときの理由。</p>');
    expect(html).toContain('<h2>検査結果</h2><p class="section-lead">spec を実行して見つかった、矛盾や書き漏れ。</p>');
  });
});

describe("仕様書の読みやすさ: 未決事項は 1 か所に書き、ほかからは番号で指す", () => {
  type Job = { status: "待機" | "実行中" | "中断" | "成功" | "失敗"; exhausted: boolean };
  const ASK_STATE = "上限で中断した実行は、どうやって終わらせるのか？";
  const ASK_ACTION = "始めるのに条件は要らないか？";
  const start = (j: Job): Job => {
    ensure(j.status === "待機", "待機のときだけ");
    ensure(!j.exhausted, "試行の上限に届いていないときだけ");
    return { ...j, status: "実行中" };
  };
  const suspend = (j: Job): Job => {
    ensure(j.status === "実行中", "実行中のときだけ");
    return { status: "中断", exhausted: true };
  };
  const resume = (j: Job): Job => {
    ensure(j.status === "中断", "中断のときだけ");
    return { ...j, status: "待機" };
  };
  const fail = (j: Job): Job => {
    ensure(j.status === "待機" || j.status === "実行中", "終わっていないときだけ");
    return { ...j, status: "失敗" };
  };
  const succeed = (j: Job): Job => {
    ensure(j.status === "実行中", "実行中のときだけ");
    return { ...j, status: "成功" };
  };
  const objectWithQuestions = () => {
    const spec = loadSpec("job", {
      initial: { status: "待機", exhausted: false },
      actors: { 人: {} },
      start,
      suspend,
      resume,
      succeed,
      fail,
      goals: { 成功: (j: Job) => j.status === "成功" },
      questions: [
        { ask: ASK_STATE, about: { status: "中断", exhausted: true } },
        { ask: ASK_ACTION, about: start },
      ],
    });
    const graph = explore(spec);
    return { spec, graph: { ...graph, omissions: findOmissionHints(spec, graph) } };
  };
  const count = (text: string, part: string) => text.split(part).length - 1;

  it("Markdown では、判断待ちと操作の節から、未決事項を番号で指す", () => {
    const { spec, graph } = objectWithQuestions();

    const md = renderMarkdown(spec, graph);

    expect(count(md, ASK_STATE)).toBe(1);
    expect(count(md, ASK_ACTION)).toBe(1);
    expect(md).toMatch(/cannot-reach-goal:中断 · exhausted`）— 未決事項 1 で判断を待っている/);
    expect(md).toContain("- **未決**: 未決事項 2");
  });

  it("HTML では、判断待ちと操作カードから、未決事項へのリンクで指す", async () => {
    const { spec, graph } = objectWithQuestions();

    // 状態をクリックしたときのパネルのデータ（script の中）は、その場で読めるよう文のまま持つので数えない。
    const html = (await renderHtml(spec, graph)).replace(/<script[\s\S]*?<\/script>/g, "");

    expect(count(html, ASK_STATE)).toBe(1);
    expect(count(html, ASK_ACTION)).toBe(1);
    expect(html).toContain('<li id="q-0-2">');
    expect(html).toContain('<a href="#q-0-2">未決事項 2</a>');
  });
});
