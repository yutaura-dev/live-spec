import { describeFinding, groupAvailability, whoOf, type ModelDiff } from "../diff.ts";
import type { ObjectDiff, ProjectDiff } from "../project-diff.ts";
import type { SurfaceNode } from "../surface.ts";
import { STATUS_LABEL, summaryOf } from "./diff-markdown.ts";
import { esc } from "./escape.ts";
import { CSS } from "./html.ts";
import { layout } from "./layout.ts";
import { edgeLabel, unionGraph } from "./union.ts";
import { surfaceToHtml } from "./wireframe.ts";

export const renderDiffHtml = async (p: ProjectDiff): Promise<string> => {
  const changed = p.objects.filter((o) => o.status !== "unchanged");
  const unchanged = p.objects.filter((o) => o.status === "unchanged");
  const sections = await Promise.all(changed.map((o, i) => objectSection(o, i)));
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>仕様の差分 — ${esc(p.base)} → ${esc(p.head)}</title>
<style>${CSS}${DIFF_CSS}</style>
</head>
<body>
<header class="top">
  <div>
    <p class="eyebrow">仕様の差分</p>
    <h1><code>${esc(p.base)}</code> → <code>${esc(p.head)}</code></h1>
    <p class="lead">${changed.length === 0 ? "仕様の変化はありません。" : `${changed.length} 個のドメインオブジェクトが変わりました。`}${unchanged.length === 0 ? "" : `変化なし: ${esc(unchanged.map((o) => o.name).join(", "))}`}</p>
  </div>
</header>
<main>
  ${
    changed.length === 0
      ? ""
      : `<table class="decision summary"><thead><tr><th>ドメインオブジェクト</th><th>変化</th><th>操作</th><th>状態</th><th>遷移</th><th>できる／できない</th><th>検査結果</th></tr></thead><tbody>${changed
          .map((o) => {
            const s = summaryOf(o.diff);
            return `<tr><td><a href="#obj-${esc(o.name)}">${esc(o.name)}</a></td><td><span class="badge ${o.status}">${STATUS_LABEL[o.status]}</span></td><td>${s.actions}</td><td>${s.states}</td><td>${s.transitions}</td><td>${s.availability}</td><td>${s.findings}</td></tr>`;
          })
          .join("")}</tbody></table>`
  }
  ${sections.join("\n")}
</main>
</body>
</html>
`;
};

const objectSection = async (o: ObjectDiff, index: number) => {
  const { nodes, edges } = unionGraph(o.before?.graph ?? null, o.after?.graph ?? null);
  // 「どの状態からでも」にはまとめない。まとめると、一部の状態からだけ消えた遷移が見えなくなるため。
  const l = await layout(
    {
      states: nodes.map((n) => ({ id: n.id, label: n.label, values: {}, initial: n.initial, terminal: false })),
      transitions: edges.map((e) => ({ from: e.from, to: e.to, action: edgeLabel(e), actors: [] })),
      availability: [],
      findings: [],
      surfaces: [],
      decisions: [],
      links: [],
      questions: [],
      scenarios: [],
    },
    { collapse: false },
  );
  const statusOfNode = new Map(nodes.map((n) => [n.id, n.status]));
  const marker = `arrow-diff-${index}`;
  const edgeSvg = l.edges
    .map((e, i) => {
      const d = e.points.map((pt, j) => `${j === 0 ? "M" : "L"}${pt.x},${pt.y}`).join(" ");
      const lb = e.label;
      return `<g class="edge diff-${edges[i]!.status}"><path d="${d}" marker-end="url(#${marker})"/><g class="edge-label"><rect x="${lb.x}" y="${lb.y}" width="${lb.width}" height="${lb.height}" rx="4"/><text x="${lb.x + lb.width / 2}" y="${lb.y + lb.height / 2}">${esc(e.action)}</text></g></g>`;
    })
    .join("");
  const nodeSvg = l.nodes
    .map(
      (n) =>
        `<g class="node diff-${statusOfNode.get(n.id)}"><rect x="${n.x}" y="${n.y}" width="${n.width}" height="${n.height}" rx="10"/><text x="${n.x + n.width / 2}" y="${n.y + n.height / 2}">${esc(n.label)}</text></g>`,
    )
    .join("");
  return `<section class="diff-object" id="obj-${esc(o.name)}">
  <h2>${esc(o.name)} <span class="badge ${o.status}">${STATUS_LABEL[o.status]}</span></h2>
  ${
    nodes.length === 0
      ? ""
      : `<div class="diagram"><svg viewBox="0 0 ${l.width} ${l.height}" width="${l.width}" height="${l.height}" role="img" aria-label="${esc(o.name)} の状態遷移図の差分"><defs><marker id="${marker}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z"/></marker></defs>${edgeSvg}${nodeSvg}</svg></div>
  <p class="legend"><span class="sw added"></span>増えた <span class="sw removed"></span>消えた <span class="sw changed"></span>通れる人が変わった <span class="sw kept"></span>変わらない</p>`
  }
  ${diffBody(o.diff)}
  ${screens(o)}
</section>`;
};

const list = (title: string, items: ReadonlyArray<string>) =>
  items.length === 0 ? "" : `<h3>${title}</h3><ul class="diff-list">${items.join("")}</ul>`;

const plus = (s: string) => `<li class="added">＋ ${esc(s)}</li>`;
const minus = (s: string) => `<li class="removed">－ ${esc(s)}</li>`;

const diffBody = (d: ModelDiff) => {
  const g = groupAvailability(d.availability);
  return [
    list("操作", [...d.actions.added.map(plus), ...d.actions.removed.map(minus)]),
    list("状態", [...d.states.added.map(plus), ...d.states.removed.map(minus)]),
    list("遷移", [...d.transitions.added.map(plus), ...d.transitions.removed.map(minus)]),
    g.flipped.length === 0
      ? ""
      : `<h3>できる／できないの変化</h3><table class="decision"><thead><tr><th>状態</th><th>操作</th><th>登場人物</th><th>変更前</th><th>変更後</th></tr></thead><tbody>${g.flipped
          .map(
            (a) =>
              `<tr><td>${esc(a.state)}</td><td>${esc(a.action)}</td><td>${esc(whoOf(a))}</td><td class="removed">${esc(a.before)}</td><td class="added">${esc(a.after)}</td></tr>`,
          )
          .join("")}</tbody></table>`,
    g.reasonOnly.length === 0
      ? ""
      : `<details class="reason-only"><summary>できない理由の言い方だけが変わったもの（${g.reasonOnly.reduce((n, r) => n + r.count, 0)} 件）</summary><table class="decision"><thead><tr><th>操作</th><th>変更前</th><th>変更後</th><th>どの状態・誰</th></tr></thead><tbody>${g.reasonOnly
          .map(
            (r) =>
              `<tr><td>${esc(r.action)}</td><td>${esc(r.before)}</td><td>${esc(r.after)}</td><td class="muted">${esc(r.cases.map((c) => `${c.state}・${whoOf(c)}`).join("、"))}</td></tr>`,
          )
          .join("")}</tbody></table></details>`,
    list("シナリオ", [
      ...d.scenarios.added.map(plus),
      ...d.scenarios.removed.map(minus),
      ...d.scenarios.changed.map((c) => `<li>${esc(c.name)}: ${c.before ? "通る" : "止まる"} → ${c.after ? "通る" : "止まる"}</li>`),
    ]),
    list("未決事項", [...d.questions.added.map(plus), ...d.questions.removed.map((q) => minus(`${q}（解決したか、取り下げた）`))]),
    list("検査結果", [...d.findings.added.map((f) => plus(describeFinding(f))), ...d.findings.removed.map((f) => minus(describeFinding(f)))]),
  ].join("");
};

// 画面が変わった「状態 × 見る人」ごとに、変更前と変更後を左右に並べる（文章の差分より、見比べるほうが早いため）。
const screens = (o: ObjectDiff) => {
  if (o.diff.surfaces.length === 0) return "";
  const surfaceOf = (side: ObjectDiff["before"], stateLabel: string, actor: string) => {
    if (side === null) return null;
    const state = side.graph.states.find((s) => s.label === stateLabel);
    const found = state === undefined ? undefined : side.graph.surfaces.find((x) => x.state === state.id && x.actor === actor);
    return found === undefined ? null : surfaceToHtml(found.surface as SurfaceNode, []);
  };
  return `<h3>画面の変化</h3>${o.diff.surfaces
    .map((s) => {
      const b = surfaceOf(o.before, s.state, s.actor);
      const a = surfaceOf(o.after, s.state, s.actor);
      return `<h4>${esc(s.state)}（${esc(s.actor)} が見る画面）</h4><div class="before-after"><div><p class="eyebrow">変更前</p>${b ?? '<p class="muted">（画面なし）</p>'}</div><div><p class="eyebrow">変更後</p>${a ?? '<p class="muted">（画面なし）</p>'}</div></div>`;
    })
    .join("")}`;
};

const DIFF_CSS = `
.diff-object{margin:40px 0;padding-top:12px;border-top:1px solid var(--line)}
.diff-object h2{display:flex;align-items:center;gap:10px}
.diff-object h3{font-size:15px;margin:20px 0 6px}
.diff-object h4{font-size:14px;margin:14px 0 6px;color:var(--muted)}
.badge{font-size:12px;font-weight:600;padding:2px 10px;border-radius:999px;background:var(--chip)}
.badge.added{background:#1d7f48;color:#fff}.badge.removed{background:#b3261e;color:#fff}.badge.changed{background:var(--accent);color:#fff}
.node.diff-added rect{stroke:#1d7f48;stroke-width:2.2;fill:rgba(29,127,72,.15)}
.node.diff-removed rect{stroke:#b3261e;stroke-width:2;stroke-dasharray:5 3;fill:rgba(179,38,30,.10)}
.node.diff-removed text{text-decoration:line-through}
.edge.diff-added path{stroke:#1d7f48;stroke-width:2.2}.edge.diff-added .edge-label text{fill:#1d7f48;font-weight:600}
.edge.diff-changed path{stroke:#c58a00;stroke-width:2.2}.edge.diff-changed .edge-label text{fill:#c58a00;font-weight:600}
.sw.changed{border-color:#c58a00;background:rgba(197,138,0,.25)}
details.reason-only{margin:14px 0}details.reason-only summary{cursor:pointer;color:var(--muted);font-size:13.5px}
.edge.diff-removed path{stroke:#b3261e;stroke-width:1.8;stroke-dasharray:5 3}.edge.diff-removed .edge-label text{fill:#b3261e;text-decoration:line-through}
.legend{font-size:12.5px;color:var(--muted);display:flex;gap:6px;align-items:center}
.sw{display:inline-block;width:14px;height:10px;border-radius:3px;margin-left:10px;border:1.5px solid var(--fg)}
.sw.added{border-color:#1d7f48;background:rgba(29,127,72,.25)}.sw.removed{border-color:#b3261e;border-style:dashed}
.diff-list{list-style:none;padding:0;margin:0}.diff-list li{padding:3px 0}
.diff-list li.added,td.added{color:#1d7f48}.diff-list li.removed,td.removed{color:#b3261e}
.before-after{display:grid;grid-template-columns:1fr 1fr;gap:16px;max-width:900px}
table.summary a{color:var(--accent)}
`;
