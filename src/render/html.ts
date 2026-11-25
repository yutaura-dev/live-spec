import type { Spec } from "../load.ts";
import type { Graph } from "../model.ts";
import type { SurfaceNode } from "../surface.ts";
import { ANY } from "./collapse.ts";
import { esc } from "./escape.ts";
import { layout, type LaidOutEdge, type LaidOutNode, type Layout } from "./layout.ts";
import { describeFinding, describeStep, formatEffect, inputCell, questionTarget, resultCell, splitEvidence } from "./markdown.ts";
import { formatTransition, presentBlocked, summarizeActions, summarizeStates, type ActionSummary } from "./summary.ts";
import { surfaceToHtml } from "./wireframe.ts";

const WIREFLOW_NODE = { width: 260, height: 220 };
const THUMB_SCALE = 0.6;

export interface DomainObject {
  readonly spec: Spec;
  readonly graph: Graph;
}

export interface ProjectOptions {
  readonly title: string;
}

export const renderHtml = (spec: Spec, graph: Graph): Promise<string> => renderProjectHtml([{ spec, graph }], { title: spec.name });

// ドメインオブジェクトごとにページを分け、1 つの HTML にまとめる理由: 1 つの図に複数のオブジェクトの
// 関心を詰め込むと、状態が組み合わせで増えて読めなくなる。オブジェクトごとのページなら図は小さく保てるうえ、
// ファイルは 1 つなので、そのまま共有できる。ページの切り替えは URL の hash（#/<名前>）で行う。
interface ProjectLink {
  readonly source: string;
  readonly from: string | null;
  readonly to: string;
  readonly action: string | null;
  readonly label: string;
}

export const renderProjectHtml = async (objects: ReadonlyArray<DomainObject>, options: ProjectOptions): Promise<string> => {
  const links: ReadonlyArray<ProjectLink> = objects.flatMap(({ spec, graph }) => graph.links.map((l) => ({ ...l, source: spec.name })));
  const pages = await Promise.all(objects.map((o, i) => renderPage(o, i, objects, links)));
  const multiple = objects.length > 1;
  const data = {
    single: multiple ? null : objects[0]!.spec.name,
    pages: Object.fromEntries(pages.map((p) => [p.name, p.data])),
  };
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(options.title)} — 仕様書</title>
<style>${CSS}</style>
</head>
<body>
${
  multiple
    ? `<header class="site">
  <a class="site-title" href="#/">${esc(options.title)}</a>
  <nav class="tabs" aria-label="ドメインオブジェクト">${objects
    .map((o) => `<a href="#/${encodeURIComponent(o.spec.name)}" data-tab="${esc(o.spec.name)}">${esc(o.spec.name)}</a>`)
    .join("")}</nav>
</header>
${await overviewPage(objects, options, links)}`
    : ""
}
${pages.map((p) => p.html).join("\n")}
<aside class="panel" id="panel" aria-live="polite" hidden></aside>
${pages.flatMap((p) => p.templates).join("\n")}
<script type="application/json" id="live-spec-data">${jsonForScript(data)}</script>
<script>${CLIENT}</script>
</body>
</html>
`;
};

const actionLabel = (objects: ReadonlyArray<DomainObject>, object: string, action: string | null) => {
  if (action === null) return "";
  const doc = objects.find((o) => o.spec.name === object)?.spec.docs[action];
  return doc === undefined ? action : `${doc.replace(/。$/, "")}（${action}）`;
};

const objectLink = (name: string) => `<a href="#/${encodeURIComponent(name)}">${esc(name)}</a>`;

// つながりの図に状態遷移図と同じ layout を使う理由: 配置の仕組みを 2 つ持たずに済み、見た目もそろうため。
const relationsSvg = async (objects: ReadonlyArray<DomainObject>, links: ReadonlyArray<ProjectLink>) => {
  const names = objects.map((o) => o.spec.name);
  const known = links.filter((l) => names.includes(l.to) && l.to !== l.source);
  if (known.length === 0) return "";
  const idOf = (name: string) => `o${names.indexOf(name)}`;
  const l = await layout({
    states: names.map((name, i) => ({ id: idOf(name), label: name, values: {}, initial: i === 0, terminal: false })),
    transitions: known.map((k) => ({ from: idOf(k.source), to: idOf(k.to), action: k.label, actors: [] })),
    availability: [],
    findings: [],
    surfaces: [],
    decisions: [],
    links: [],
    questions: [],
    scenarios: [],
  });
  const nodes = l.nodes
    .map(
      (n) =>
        `<a href="#/${encodeURIComponent(n.label)}" class="rel-node"><rect x="${n.x}" y="${n.y}" width="${n.width}" height="${n.height}" rx="10"/><text x="${n.x + n.width / 2}" y="${n.y + n.height / 2}">${esc(n.label)}</text></a>`,
    )
    .join("");
  return `<div class="diagram relations"><svg viewBox="0 0 ${l.width} ${l.height}" width="${l.width}" height="${l.height}" role="img" aria-label="ドメインオブジェクトのつながり">
    <defs><marker id="arrow-rel" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z"/></marker></defs>
    ${l.edges.map((e) => edgeSvg(e, "arrow-rel")).join("")}${nodes}
  </svg></div>`;
};

const overviewPage = async (objects: ReadonlyArray<DomainObject>, options: ProjectOptions, links: ReadonlyArray<ProjectLink>) => `<section class="page" data-page="" hidden>
<header class="top">
  <div>
    <p class="eyebrow">仕様書</p>
    <h1>${esc(options.title)}</h1>
    <p class="lead">ドメインオブジェクト ${objects.length} 個</p>
  </div>
</header>
<main>
  <div class="cards">
    ${objects
      .map(
        ({ spec, graph }) => `<a class="card object-card" href="#/${encodeURIComponent(spec.name)}">
      <h3>${esc(spec.name)}</h3>
      ${spec.stateDoc === null ? "" : `<p class="object-doc">${esc(spec.stateDoc)}</p>`}
      <dl class="object-stats"><div><dt>状態</dt><dd>${graph.states.length}</dd></div><div><dt>操作</dt><dd>${spec.actions.length}</dd></div><div><dt>未決</dt><dd class="${graph.questions.length === 0 ? "" : "warn"}">${graph.questions.length}</dd></div><div><dt>検査</dt><dd class="${graph.findings.length === 0 ? "ok" : "warn"}">${graph.findings.length === 0 ? "OK" : graph.findings.length}</dd></div></dl>
    </a>`,
      )
      .join("\n    ")}
  </div>
  ${
    links.length === 0
      ? ""
      : `<section class="links-section">
    <h2>つながり</h2>
    ${await relationsSvg(objects, links)}
    <ul class="link-list">${links
      .map(
        (l) =>
          `<li>${objectLink(l.source)}${l.from === null ? "" : ` の ${esc(actionLabel(objects, l.source, l.from))}`} → ${objectLink(l.to)}${l.action === null ? "" : ` の ${esc(actionLabel(objects, l.to, l.action))}`}<span class="sub">${esc(l.label)}</span></li>`,
      )
      .join("")}</ul>
  </section>`
  }
</main>
</section>`;

const renderPage = async (
  { spec, graph }: DomainObject,
  index: number,
  objects: ReadonlyArray<DomainObject>,
  links: ReadonlyArray<ProjectLink>,
) => {
  const outgoing = links.filter((l) => l.source === spec.name);
  const incoming = links.filter((l) => l.to === spec.name && l.source !== spec.name);
  const connections =
    outgoing.length + incoming.length === 0
      ? ""
      : `<section class="links-section">
    <h2>つながり</h2>
    <ul class="link-list">${outgoing
      .map(
        (l) =>
          `<li>${l.from === null ? "" : `${esc(actionLabel(objects, spec.name, l.from))} `}→ ${objectLink(l.to)}${l.action === null ? "" : ` の ${esc(actionLabel(objects, l.to, l.action))}`}<span class="sub">${esc(l.label)}</span></li>`,
      )
      .join("")}${incoming
      .map(
        (l) =>
          `<li>${l.action === null ? "" : `${esc(actionLabel(objects, spec.name, l.action))} `}← ${objectLink(l.source)}${l.from === null ? "" : ` の ${esc(actionLabel(objects, l.source, l.from))}`}<span class="sub">${esc(l.label)}</span></li>`,
      )
      .join("")}</ul>
  </section>`;
  const linksOf = (action: string) => outgoing.filter((l) => l.from === action);
  const l = await layout(graph);
  const actions = summarizeActions(spec, graph);
  const labelOf = (id: string) => graph.states.find((s) => s.id === id)?.label ?? id;
  const initial = graph.states.find((s) => s.initial);
  const terminal = new Set(graph.states.filter((s) => s.terminal).map((s) => s.id));
  const violating = new Set(graph.findings.flatMap((f) => (f.kind === "invariant-violation" ? [f.state] : [])));
  const notAllowed = (state: string, actors: ReadonlyArray<string>) =>
    graph.findings.flatMap((f) =>
      f.kind === "surface-action-not-allowed" && f.state === state && actors.includes(f.actor) ? [f.action] : [],
    );
  const states = summarizeStates(spec, graph);
  // id にページの番号を入れる理由: 状態の ID（s0, s1…）はドメインオブジェクトごとに振られるので、
  // 1 つの HTML に複数のページを入れると、テンプレートや図の矢印の id が衝突する。
  const templateId = (state: string, i: number) => `sf-${index}-${state}-${i}`;
  // パネルの画面はサーバ側で描いた HTML を <template> に置き、クライアントは複製するだけにする。
  const templates = states.flatMap((s) =>
    s.surfaces.map(
      (g, i) => `<template id="${esc(templateId(s.id, i))}">${surfaceToHtml(g.surface as SurfaceNode, notAllowed(s.id, g.actors))}</template>`,
    ),
  );
  const data = {
    states: states.map((s) => ({ ...s, surfaces: s.surfaces.map((g, i) => ({ actors: g.actors, template: templateId(s.id, i) })) })),
    questions: Object.fromEntries(
      graph.states.map((s) => [s.id, graph.questions.filter((q) => q.states.includes(s.id)).map((q) => q.ask)]),
    ),
    terms: Object.fromEntries(graph.states.map((s) => [s.id, termsOf(s.id)])),
    scenarios: Object.fromEntries(
      graph.scenarios.map((s) => [s.name, s.steps.filter((st) => st.ok).map((st) => ({ from: st.from, to: st.to, action: st.action }))]),
    ),
  };
  const scenarioCard = (s: Graph["scenarios"][number]) => `<article class="card scenario-card" data-scenario="${esc(s.name)}" tabindex="0">
        <h3>${s.passed ? "✅" : "❌"} ${esc(s.name)}</h3>
        <ol class="storyboard">${s.steps
          .map((st) => {
            const shown = st.to === null ? undefined : graph.surfaces.find((x) => x.state === st.to && x.actor === st.actor);
            return `<li class="${st.ok ? "" : "failed"}"><p class="step">${esc(describeStep(spec, st))}</p>${
              st.ok
                ? `<p class="flow">${esc(labelOf(st.from ?? ""))} → ${esc(labelOf(st.to ?? ""))}</p>`
                : `<p class="reason">❌ ${esc(st.reason ?? "")}</p>`
            }${shown === undefined ? "" : `<div class="frame"><div class="frame-inner">${surfaceToHtml(shown.surface as SurfaceNode, notAllowed(st.to!, [st.actor]))}</div></div>`}</li>`;
          })
          .join("")}</ol>
      </article>`;
  const actorNames = spec.actors.map(([name]) => name);
  const thumbsOf = (state: string) =>
    actorNames.map((actor) => {
      const found = graph.surfaces.find((x) => x.state === state && x.actor === actor);
      const html =
        found === undefined
          ? '<p class="wf-text">（画面がありません）</p>'
          : surfaceToHtml(found.surface as SurfaceNode, notAllowed(state, [actor]));
      return [actor, html] as const;
    });
  const wl = graph.surfaces.length > 0 ? await layout(graph, { nodeSize: WIREFLOW_NODE }) : null;
  const questioned = new Set(graph.questions.flatMap((q) => q.states));
  // ノードにカーソルを合わせたとき、状態の名前に含まれる用語の説明を出す（名前だけでは意味が伝わらないことがあるため）。
  // データ（data）を組み立てる時点でも使うので、巻き上げられる関数宣言にしている。
  function termsOf(id: string) {
    return labelOf(id)
      .split(" · ")
      .flatMap((part) => (spec.glossary[part] === undefined ? [] : [`${part}: ${spec.glossary[part]}`]));
  }
  const flags = (id: string) => ({
    terms: termsOf(id),
    initial: id === initial?.id,
    terminal: terminal.has(id),
    violation: violating.has(id),
    question: questioned.has(id),
  });
  const asksOf = (action: string) => graph.questions.filter((q) => q.action === action).map((q) => q.ask);
  const arrow = `arrow-${index}`;
  const arrowWf = `arrow-wf-${index}`;

  const html = `<section class="page" data-page="${esc(spec.name)}" hidden>
<header class="top">
  <div>
    <p class="eyebrow">ドメインオブジェクト</p>
    <h1>${esc(spec.name)}</h1>
    ${spec.stateDoc === null ? "" : `<p class="lead">${esc(spec.stateDoc)}</p>`}
  </div>
  <dl class="stats">
    <div><dt>状態</dt><dd>${graph.states.length}</dd></div>
    <div><dt>操作</dt><dd>${actions.length}</dd></div>
    <div><dt>未決</dt><dd class="${graph.questions.length === 0 ? "" : "warn"}">${graph.questions.length}</dd></div>
    <div><dt>検査</dt><dd class="${graph.findings.length === 0 ? "ok" : "warn"}">${graph.findings.length === 0 ? "OK" : graph.findings.length}</dd></div>
  </dl>
</header>
<main>
  ${
    graph.questions.length === 0
      ? ""
      : `<section class="questions" aria-label="未決事項">
    <h2>未決事項</h2>
    <ol>${graph.questions
      .map((q) => `<li><span class="ask">${esc(q.ask)}</span><span class="target">${esc(questionTarget(spec, q, labelOf))}</span>${q.note === null ? "" : `<span class="note">${esc(q.note)}</span>`}</li>`)
      .join("")}</ol>
  </section>`
  }
  <section class="board" aria-label="状態遷移図" data-mode="states">
    <p class="hint">状態をクリックすると、その状態でできること・できないことを表示します。矢印のラベルや操作カードをクリックすると、その操作の遷移を強調します。Esc で解除。</p>
    ${
      wl === null
        ? ""
        : `<div class="toolbar">
      <div class="modes" role="group" aria-label="図の表示"><button type="button" data-mode="states" aria-pressed="true">状態遷移図</button><button type="button" data-mode="wireflow" aria-pressed="false">画面つき</button></div>
      <label class="viewpoint">視点 <select class="viewpoint-select">${actorNames.map((a) => `<option value="${esc(a)}">${esc(a)}</option>`).join("")}</select></label>
    </div>`
    }
    <div class="diagram diagram-states">
      ${diagramSvg(spec.name, l, arrow, (n) => nodeSvg(n, flags(n.id), arrow))}
    </div>
    ${
      wl === null
        ? ""
        : `<div class="diagram diagram-wireflow">
      ${diagramSvg(spec.name, wl, arrowWf, (n) => wireflowNodeSvg(n, flags(n.id), thumbsOf(n.id), actorNames[0], arrowWf))}
    </div>`
    }
  </section>
  ${glossaryHtml(spec)}
  <section class="actions">
    <h2>操作</h2>
    <div class="cards">
      ${actions.map((a) => actionCard(a, asksOf(a.name), linksOf(a.name), spec.evidence[a.name] ?? [])).join("\n      ")}
    </div>
  </section>
  ${
    graph.decisions.length === 0
      ? ""
      : `<section class="decisions">
    <h2>ルール</h2>
    ${graph.decisions
      .map(
        (d) => `<h3>${esc(d.name)}</h3><table class="decision"><thead><tr>${d.columns.map((c) => `<th>${esc(c)}</th>`).join("")}<th>結果</th></tr></thead><tbody>${d.rows
          .map(
            (r) => `<tr class="${r.ok ? "" : "ng"}">${d.columns.map((c) => `<td>${esc(inputCell(r.input, c))}</td>`).join("")}<td class="result">${esc(resultCell(r))}</td></tr>`,
          )
          .join("")}</tbody></table>`,
      )
      .join("\n    ")}
  </section>`
  }
  ${connections}
  ${
    graph.scenarios.length === 0
      ? ""
      : `<section class="scenarios">
    <h2>シナリオ</h2>
    <p class="hint">シナリオを選ぶと、状態遷移図の上でその経路を強調します。各段階には、操作した人に見える画面を並べます。</p>
    ${graph.scenarios.map(scenarioCard).join("\n    ")}
  </section>`
  }
  <section class="findings">
    <h2>検査結果</h2>
    ${
      graph.findings.length === 0
        ? '<p class="ok-line">問題は見つかりませんでした。</p>'
        : `<ul>${graph.findings.map((f) => `<li>${esc(describeFinding(f, labelOf))}</li>`).join("")}</ul>`
    }
  </section>
</main>
</section>`;
  return { name: spec.name, html, templates, data };
};

export const renderErrorHtml = (name: string, error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(name)} — 生成エラー</title>
<style>${CSS}
.error{margin:40px;max-width:72ch}.error pre{white-space:pre-wrap;background:var(--card);border:1px solid var(--warn);border-radius:12px;padding:16px;color:var(--warn)}</style>
</head>
<body>
<main class="error">
  <p class="eyebrow">仕様書を生成できませんでした</p>
  <h1>${esc(name)}</h1>
  <pre>${esc(message)}</pre>
  <p class="hint">spec ファイルを直して保存すると、自動で生成し直します。生成し直したら、このページを再読み込みしてください。</p>
</main>
</body>
</html>
`;
};

interface NodeFlags {
  readonly terms: ReadonlyArray<string>;
  readonly initial: boolean;
  readonly terminal: boolean;
  readonly violation: boolean;
  readonly question: boolean;
}

const diagramSvg = (name: string, l: Layout, markerId: string, node: (n: LaidOutNode) => string) =>
  `<svg viewBox="0 0 ${l.width + 24} ${l.height}" width="${l.width + 24}" height="${l.height}" role="img" aria-label="${esc(name)} の状態遷移図">
        <defs><marker id="${markerId}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z"/></marker></defs>
        <g transform="translate(24 0)">
        ${l.edges.map((e) => edgeSvg(e, markerId)).join("\n        ")}
        ${l.nodes.map(node).join("\n        ")}
        </g>
      </svg>`;

const glossaryHtml = (spec: Spec) => {
  const fields = Object.entries(spec.fieldDocs).map(([field, doc]) => {
    const values = spec.fields[field];
    return `<dt>${esc(field)} <span class="kind">項目</span></dt><dd>${esc(doc)}${values === undefined ? "" : `<span class="sub">値: ${esc(values.map(String).join(" / "))}</span>`}</dd>`;
  });
  const terms = Object.entries(spec.glossary).map(([term, doc]) => `<dt>${esc(term)}</dt><dd>${esc(doc)}</dd>`);
  return fields.length + terms.length === 0
    ? ""
    : `<section class="glossary"><h2>用語</h2><dl>${[...fields, ...terms].join("")}</dl></section>`;
};

const nodeClass = (f: NodeFlags, extra = "") =>
  ["node", f.initial ? "initial" : "", f.terminal ? "terminal" : "", f.violation ? "violation" : "", f.question ? "has-question" : "", extra]
    .filter(Boolean)
    .join(" ");

const questionMark = (n: LaidOutNode, f: NodeFlags) =>
  f.question ? `<g class="q-mark"><circle cx="${n.x + n.width - 2}" cy="${n.y + 2}" r="8"/><text x="${n.x + n.width - 2}" y="${n.y + 2}">?</text></g>` : "";

const startMarker = (n: LaidOutNode, cy: number, markerId: string) =>
  `<circle class="start" cx="${n.x - 18}" cy="${cy}" r="5"/><path class="start-line" d="M${n.x - 13},${cy} L${n.x - 2},${cy}" marker-end="url(#${markerId})"/>`;

const terminalRect = (n: LaidOutNode) =>
  `<rect class="inner" x="${n.x + 3}" y="${n.y + 3}" width="${n.width - 6}" height="${n.height - 6}" rx="7"/>`;

// 「どの状態からでも」は実在の状態ではないので、点線で描き、クリックできる状態（data-state）にはしない。
const anyNodeSvg = (n: LaidOutNode) =>
  `<g class="any-node"><rect x="${n.x}" y="${n.y}" width="${n.width}" height="${n.height}" rx="${n.height / 2}"/><text x="${n.x + n.width / 2}" y="${n.y + n.height / 2}">${esc(n.label)}</text></g>`;

const nodeSvg = (n: LaidOutNode, f: NodeFlags, markerId: string) => {
  if (n.id === ANY) return anyNodeSvg(n);
  const cy = n.y + n.height / 2;
  return `${f.initial ? startMarker(n, cy, markerId) : ""}<g class="${nodeClass(f)}" data-state="${esc(n.id)}" tabindex="0" role="button" aria-label="状態 ${esc(n.label)}"><rect x="${n.x}" y="${n.y}" width="${n.width}" height="${n.height}" rx="10"/>${f.terms.length === 0 ? "" : `<title>${esc(f.terms.join("\n"))}</title>`}${f.terminal ? terminalRect(n) : ""}<text x="${n.x + n.width / 2}" y="${cy}">${esc(n.label)}</text>${questionMark(n, f)}</g>`;
};

// サムネイルを SVG の foreignObject に入れる理由: パネルと同じ HTML のワイヤーフレームを、
// 縮小してそのまま図の中に置けるため。見る人ごとに用意し、視点の切り替えで表示を変える。
const wireflowNodeSvg = (
  n: LaidOutNode,
  f: NodeFlags,
  thumbs: ReadonlyArray<readonly [string, string]>,
  visible: string | undefined,
  markerId: string,
) => {
  if (n.id === ANY) return anyNodeSvg(n);
  const inner = n.width - 16;
  const thumbHtml = thumbs
    .map(
      ([actor, html]) =>
        `<div class="thumb" data-actor="${esc(actor)}"${actor === visible ? "" : " hidden"}><div class="thumb-inner" style="width:${inner / THUMB_SCALE}px">${html}</div></div>`,
    )
    .join("");
  return `${f.initial ? startMarker(n, n.y + n.height / 2, markerId) : ""}<g class="${nodeClass(f, "wf-node")}" data-state="${esc(n.id)}" tabindex="0" role="button" aria-label="状態 ${esc(n.label)}"><rect x="${n.x}" y="${n.y}" width="${n.width}" height="${n.height}" rx="10"/>${f.terminal ? terminalRect(n) : ""}<text class="wf-node-label" x="${n.x + 12}" y="${n.y + 16}">${esc(n.label)}</text><foreignObject x="${n.x + 8}" y="${n.y + 30}" width="${inner}" height="${n.height - 38}"><div class="thumb-frame">${thumbHtml}</div></foreignObject></g>`;
};

const edgeSvg = (e: LaidOutEdge, markerId: string) => {
  const d = e.points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
  const lb = e.label;
  return `<g class="edge" data-action="${esc(e.action)}" data-from="${esc(e.from)}" data-to="${esc(e.to)}"><path d="${d}" marker-end="url(#${markerId})"/><g class="edge-label"><rect x="${lb.x}" y="${lb.y}" width="${lb.width}" height="${lb.height}" rx="4"/><text x="${lb.x + lb.width / 2}" y="${lb.y + lb.height / 2}">${esc(e.action)}</text></g></g>`;
};

const actionCard = (
  a: ActionSummary,
  asks: ReadonlyArray<string>,
  links: ReadonlyArray<ProjectLink>,
  evidence: ReadonlyArray<string>,
) => {
  const others =
    a.othersReasons.length === 0 ? "" : `<span class="muted">ほかの人は「${a.othersReasons.map(esc).join("」「")}」</span>`;
  const who =
    a.capable.length === 0
      ? '<span class="muted">なし（どの状態でも誰も実行できない）</span>'
      : `${a.capable.map((c) => `<span class="chip">${esc(c)}</span>`).join("")}${others}`;
  const when =
    a.when.length === 0
      ? '<span class="muted">なし</span>'
      : a.when.map((w) => `<span class="flow">${esc(formatTransition(w))}</span>`).join("");
  const blocked = presentBlocked(a.blocked).map(
    (b) =>
      `<li><span class="reason">${esc(b.reason)}</span> ${
        b.states === null ? '<span class="state rest">それ以外のすべての状態</span>' : b.states.map((s) => `<span class="state">${esc(s)}</span>`).join("")
      }</li>`,
  );
  const whenNot = blocked.length === 0 ? '<span class="muted">なし</span>' : `<ul>${blocked.join("")}</ul>`;
  const effect = formatEffect(a);
  return `<article class="card" data-action="${esc(a.name)}" tabindex="0">
        <h3>${a.summary === null ? "" : `${esc(a.summary)} `}<code>${esc(a.name)}</code>${asks.length === 0 ? "" : ` <span class="q-badge">未決 ${asks.length}</span>`}</h3>
        <dl>
          <dt>できる人</dt><dd>${who}</dd>
          <dt>できるとき</dt><dd>${when}</dd>
          <dt>できないとき</dt><dd>${whenNot}</dd>
          ${a.inputOutcomes.length === 0 ? "" : `<dt>入力ごとの結果</dt><dd><ul>${a.inputOutcomes.map((o) => `<li><span class="reason">${esc(o.input)}</span> ${o.transitions.length > 0 ? o.transitions.map((t) => `<span class="flow">${esc(formatTransition(t))}</span>`).join("") : `<span class="state">❌ ${esc(o.reasons.join("、"))}</span>`}</li>`).join("")}</ul></dd>`}
          ${effect === "" ? "" : `<dt>結果</dt><dd>${esc(effect)}</dd>`}
          ${
            evidence.length === 0
              ? ""
              : `<dt>根拠</dt><dd>${evidence
                  .map((e) => {
                    const { path, rest } = splitEvidence(e);
                    return `<span class="ev"><code class="evidence">${esc(path)}</code>${esc(rest)}</span>`;
                  })
                  .join("")}</dd>`
          }
          ${links.length === 0 ? "" : `<dt>つながり</dt><dd>${links.map((l) => `<span class="flow">→ ${objectLink(l.to)}${l.action === null ? "" : ` の ${esc(l.action)}`}</span>`).join("")}<span class="muted">${esc(links.map((l) => l.label).join(" / "))}</span></dd>`}
          ${asks.length === 0 ? "" : `<dt>未決</dt><dd><ul>${asks.map((q) => `<li class="ask">${esc(q)}</li>`).join("")}</ul></dd>`}
        </dl>
      </article>`;
};


// < などをエスケープする理由: spec の文字列に "</script>" が含まれていても、
// 埋め込んだ JSON が script 要素を途中で閉じないようにするため。
const jsonForScript = (data: unknown) =>
  JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/\u{2028}/gu, "\\u2028")
    .replace(/\u{2029}/gu, "\\u2029");

export const CSS = `
:root{--bg:#f6f5f1;--fg:#1c1c1e;--muted:#6e6d72;--line:#d9d6cd;--card:#fff;--node:#fff;--accent:#2b59e0;--accent-weak:#e5ebfc;--ok:#1d7f48;--warn:#b3501a;--chip:#efeee9}
@media (prefers-color-scheme:dark){:root{--bg:#141416;--fg:#ececee;--muted:#9a99a0;--line:#34343a;--card:#1c1c20;--node:#1f1f24;--accent:#7f9dff;--accent-weak:#232b45;--ok:#5cc98b;--warn:#f0a46b;--chip:#2a2a30}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.65 system-ui,-apple-system,"Hiragino Sans","Noto Sans JP",sans-serif}
code{font:13px ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--chip);padding:1px 6px;border-radius:5px}
.top{display:flex;justify-content:space-between;align-items:flex-end;gap:24px;padding:40px 40px 24px;border-bottom:1px solid var(--line)}
.eyebrow{margin:0 0 4px;font-size:12px;letter-spacing:.08em;color:var(--muted)}
h1{margin:0;font-size:32px;letter-spacing:-.01em}
.lead{margin:8px 0 0;color:var(--muted);max-width:60ch}
.stats{display:flex;gap:28px;margin:0}
.stats div{text-align:right}.stats dt{font-size:12px;color:var(--muted)}.stats dd{margin:0;font-size:24px;font-weight:600}
.stats .ok{color:var(--ok)}.stats .warn{color:var(--warn)}
main{padding:24px 40px 64px}
h2{font-size:18px;margin:40px 0 16px}
.board .hint{margin:0 0 10px}
.diagram{background:var(--card);border:1px solid var(--line);border-radius:14px;overflow:auto;padding:8px}
.diagram svg{display:block;max-width:100%;height:auto;margin:0 auto}
.panel{position:fixed;top:16px;right:16px;width:400px;max-height:calc(100vh - 32px);overflow:auto;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px;box-shadow:0 12px 40px rgba(0,0,0,.25);z-index:10}
.panel[hidden]{display:none}
.panel h2{margin:0 0 12px;font-size:20px}
.panel h3{font-size:13px;color:var(--muted);margin:18px 0 6px;font-weight:600}
.panel ul{list-style:none;margin:0;padding:0}
.panel li{padding:6px 0;border-top:1px solid var(--line)}
.panel li:first-child{border-top:0}
.panel .sub{display:block;font-size:12px;color:var(--muted)}
.panel .tag{display:inline-block;font-size:11px;padding:1px 8px;border-radius:999px;background:var(--chip);margin-right:6px}
.panel button{margin-top:16px;font:inherit;font-size:13px;background:none;border:1px solid var(--line);color:var(--fg);border-radius:8px;padding:4px 12px;cursor:pointer}
.hint{font-size:12px;color:var(--muted)}
.site{position:sticky;top:0;z-index:5;display:flex;gap:24px;align-items:center;padding:10px 40px;background:var(--bg);border-bottom:1px solid var(--line)}
.site-title{font-weight:700;color:var(--fg);text-decoration:none}
.tabs{display:flex;gap:4px;flex-wrap:wrap}
.tabs a{color:var(--muted);text-decoration:none;padding:4px 12px;border-radius:8px;font-size:14px}
.tabs a:hover{color:var(--fg)}
.tabs a[aria-current="page"]{background:var(--accent-weak);color:var(--accent);font-weight:600}
.page[hidden]{display:none}
.object-card{display:block;color:var(--fg);text-decoration:none}
.object-card h3{font-size:18px}
.object-doc{color:var(--muted);margin:0 0 12px}
.card .object-stats{display:flex;gap:20px;margin:0}
.object-stats dt{font-size:12px;color:var(--muted)}.object-stats dd{margin:0;font-weight:600;font-size:18px}
.object-stats .ok{color:var(--ok)}.object-stats .warn{color:var(--warn)}
.toolbar{display:flex;gap:16px;align-items:center;margin:0 0 10px;font-size:13px}
.modes{display:inline-flex;border:1px solid var(--line);border-radius:8px;overflow:hidden}
.modes button{font:inherit;font-size:13px;background:none;border:0;color:var(--muted);padding:4px 12px;cursor:pointer}
.modes button[aria-pressed="true"]{background:var(--accent-weak);color:var(--accent);font-weight:600}
.viewpoint{color:var(--muted)}.viewpoint select{font:inherit;font-size:13px;margin-left:4px}
.board[data-mode="states"] .diagram-wireflow,.board[data-mode="wireflow"] .diagram-states{display:none}
.board:not([data-mode="wireflow"]) .viewpoint{display:none}
svg text.wf-node-label{text-anchor:start;font-weight:600;font-size:13px}
.thumb-frame{width:100%;height:100%;overflow:hidden;pointer-events:none}
.thumb-inner{transform:scale(${THUMB_SCALE});transform-origin:0 0}
.wf-group{margin:10px 0 16px}
.wf-screen{border:1.5px solid var(--fg);border-radius:8px;background:var(--node);font-size:13px;overflow:hidden}
.wf-title{border-bottom:1.5px solid var(--fg);padding:6px 10px;font-weight:600;display:flex;gap:6px;align-items:center}
.wf-title::before{content:"";width:28px;height:6px;border-radius:3px;background:repeating-linear-gradient(90deg,var(--muted) 0 6px,transparent 6px 11px)}
.wf-body{padding:10px;display:flex;flex-direction:column;gap:8px;align-items:flex-start}
.wf-section{border:1px dashed var(--muted);border-radius:6px;padding:8px;align-self:stretch;display:flex;flex-direction:column;gap:6px;align-items:flex-start}
.wf-section > .wf-label{font-size:11.5px;color:var(--muted)}
.wf-heading{font-weight:600;font-size:14px}
.wf-text{margin:0}
.wf-field{display:flex;flex-direction:column;gap:2px;align-self:stretch;font-size:11.5px;color:var(--muted)}
.wf-input{border:1.2px solid var(--muted);border-radius:4px;min-height:24px;padding:2px 6px;color:var(--fg);font-size:12.5px}
.wf-button{border:1.5px solid var(--fg);border-radius:6px;padding:2px 12px;font-size:12.5px;font-weight:600}
.wf-button.is-disabled{opacity:.4;border-style:dashed}
.wf-button.is-invalid{border-color:var(--warn);color:var(--warn)}
.wf-button.is-invalid::after{content:" ⚠"}
.wf-badge{border:1px solid var(--muted);border-radius:999px;padding:0 8px;font-size:11px;color:var(--muted)}
.wf-list{margin:0;padding-left:18px;align-self:stretch}
.wf-code{margin:0;align-self:stretch;background:var(--chip);border-radius:6px;padding:8px;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap}
.wf-code[data-language="terminal"]{background:#111;color:#e6e6e6}
svg text{font-size:13px;fill:var(--fg);text-anchor:middle;dominant-baseline:central}
marker path{fill:var(--muted)}
.node{cursor:pointer;outline:none}
.node rect{fill:var(--node);stroke:var(--fg);stroke-width:1.4}
.node rect.inner{fill:none;stroke-width:1}
.node:hover rect,.node:focus-visible rect{stroke:var(--accent)}
.node.violation rect{stroke:var(--warn);stroke-width:2;stroke-dasharray:5 3}
.panel .tag.warn{background:var(--warn);color:var(--bg)}
.panel .violation{color:var(--warn);font-size:13px;margin:10px 0 0}
.start{fill:var(--fg)}.start-line{stroke:var(--fg);stroke-width:1.4}
.edge{cursor:pointer}
.edge path{fill:none;stroke:var(--muted);stroke-width:1.3}
.edge-label rect{fill:var(--card)}
.edge-label text{font-size:11.5px;fill:var(--muted)}
.edge:hover path{stroke:var(--accent)}.edge:hover .edge-label text{fill:var(--accent)}
.is-dim{opacity:.18;transition:opacity .15s}
.node.is-selected rect{stroke:var(--accent);stroke-width:2.2;fill:var(--accent-weak)}
.edge.is-active path{stroke:var(--accent);stroke-width:2.2}
.edge.is-active .edge-label text{fill:var(--accent);font-weight:600}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px 20px;cursor:pointer;outline:none}
.card:hover,.card:focus-visible{border-color:var(--accent)}
.card.is-selected{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-weak)}
.card h3{margin:0 0 12px;font-size:16px}
.card dl{display:grid;grid-template-columns:5.5em 1fr;gap:8px 12px;margin:0;font-size:14px}
.card dt{color:var(--muted);font-size:12.5px;padding-top:2px}
.card dd{margin:0}
.card ul{margin:0;padding:0;list-style:none}
.card li+li{margin-top:6px}
.chip,.state,.flow{display:inline-block;font-size:12.5px;border-radius:6px;padding:0 7px;margin:0 4px 4px 0;background:var(--chip)}
.flow{background:var(--accent-weak)}
.questions{border:1px solid var(--warn);border-radius:14px;padding:4px 20px 12px;margin:0 0 20px;background:var(--card)}
.questions h2{margin:14px 0 8px;color:var(--warn);font-size:16px}
.questions ol{margin:0;padding-left:20px}
.questions li{margin:6px 0}
.questions .ask{font-weight:600}
.questions .target{color:var(--muted);font-size:13px;margin-left:4px}
.questions .note{display:block;color:var(--muted);font-size:13px}
.q-badge{display:inline-block;font-size:11px;font-weight:600;padding:1px 8px;border-radius:999px;background:var(--warn);color:var(--bg);vertical-align:middle}
.card .ask{color:var(--warn);font-size:13px}
.q-mark circle{fill:var(--warn)}
.q-mark text{fill:var(--bg);font-size:11px;font-weight:700}
.stats .warn,.object-stats .warn{color:var(--warn)}
.links-section{margin:0 0 8px}
.link-list{list-style:none;padding:0;margin:8px 0 0}
.link-list li{padding:6px 0;border-top:1px solid var(--line)}
.link-list li:first-child{border-top:0}
.link-list .sub{display:block;color:var(--muted);font-size:13px}
.link-list a,.card .flow a{color:var(--accent)}
.relations{margin-bottom:12px}
.rel-node rect{fill:var(--node);stroke:var(--fg);stroke-width:1.4}
.rel-node:hover rect{stroke:var(--accent)}
.any-node rect{fill:none;stroke:var(--muted);stroke-width:1.2;stroke-dasharray:4 3}
.any-node text{fill:var(--muted);font-size:12px}
.glossary dl{display:grid;grid-template-columns:max-content 1fr;gap:6px 16px;margin:0}
.glossary dt{font-weight:600}
.glossary .kind{font-size:11px;color:var(--muted);font-weight:400;margin-left:4px}
.glossary .sub{display:block;color:var(--muted);font-size:13px}
.ev{display:block;font-size:13px}
code.evidence{font-size:12px}
table.decision{border-collapse:collapse;margin:8px 0 20px;background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:hidden;font-size:14px}
table.decision th,table.decision td{padding:6px 14px;border-bottom:1px solid var(--line);text-align:left}
table.decision th{color:var(--muted);font-weight:600;font-size:12.5px}
table.decision td.result{font-weight:600}
table.decision tr.ng td.result{color:var(--warn)}
.decisions h3{font-size:15px;margin:16px 0 4px}
.scenario-card{margin-bottom:16px}
.storyboard{display:flex;gap:14px;overflow-x:auto;list-style:none;margin:0;padding:0 0 6px;counter-reset:step}
.storyboard li{flex:0 0 220px;counter-increment:step}
.storyboard li::before{content:counter(step);display:inline-block;width:20px;height:20px;border-radius:50%;background:var(--accent-weak);color:var(--accent);font-size:12px;font-weight:700;text-align:center;line-height:20px;margin-bottom:4px}
.storyboard li.failed::before{background:var(--warn);color:var(--bg)}
.storyboard .step{margin:0 0 4px;font-size:13px;font-weight:600}
.storyboard .flow{margin:0 0 8px;font-size:12px;display:inline-block}
.storyboard .reason{margin:0;color:var(--warn);font-size:12.5px}
.storyboard .frame{height:200px;overflow:hidden;border-radius:8px}
.storyboard .frame-inner{width:366px;transform:scale(.6);transform-origin:0 0;pointer-events:none}
.state.rest{background:none;border:1px dashed var(--line)}
.reason{font-weight:600;margin-right:4px}
.muted{color:var(--muted);font-size:13px;display:block}
.findings ul{padding-left:20px}.findings li{color:var(--warn)}
.ok-line{color:var(--ok)}
@media (max-width:960px){.top{flex-direction:column;align-items:flex-start;padding:28px 20px 20px}main{padding:16px 20px 48px}.panel{left:16px;right:16px;width:auto;top:auto;bottom:16px;max-height:60vh}}
@media print{.panel,.board .hint{display:none}.card{break-inside:avoid}}
`;

// クライアントの描画で innerHTML を使わない理由: 状態名や理由は spec 由来の文字列なので、
// textContent で組み立てて HTML として解釈される余地をなくすため。
const CLIENT = `
(function () {
  var data = JSON.parse(document.getElementById("live-spec-data").textContent);
  var panel = document.getElementById("panel");
  var current = null;

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function all(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }
  // 表示中のページの中だけを探す。状態の ID はドメインオブジェクトごとに s0 から振られるので、
  // ページをまたいで探すと別のオブジェクトの状態まで選んでしまう。
  function within(sel) { return current ? Array.prototype.slice.call(current.el.querySelectorAll(sel)) : []; }
  function attr(name, value) { return "[" + name + '="' + CSS.escape(value) + '"]'; }
  function hashOf(name, state) { return "#/" + encodeURIComponent(name) + (state ? "/" + encodeURIComponent(state) : ""); }
  function clear() {
    all(".is-selected,.is-active,.is-dim").forEach(function (n) { n.classList.remove("is-selected", "is-active", "is-dim"); });
  }
  function dimAll() { within(".node,.edge").forEach(function (n) { n.classList.add("is-dim"); }); }
  function undim(n) { if (n) n.classList.remove("is-dim"); }
  function nodes(id) { return within(".node" + attr("data-state", id)); }
  function closePanel() { clear(); panel.replaceChildren(); panel.hidden = true; }
  function reset() {
    closePanel();
    if (current && current.name) history.replaceState(null, "", hashOf(current.name));
  }

  function list(items, render) {
    var ul = el("ul");
    if (items.length === 0) ul.append(el("li", "sub", "なし"));
    items.forEach(function (item) { ul.append(render(item)); });
    return ul;
  }

  function selectState(id) {
    var page = current && data.pages[current.name];
    var s = page && page.states.find(function (x) { return x.id === id; });
    if (!s) return;
    clear(); dimAll();
    // 選択を URL の hash に残す理由: リンクで共有でき、--serve で自動再読み込みしたあとも同じ状態を見続けられるため。
    history.replaceState(null, "", hashOf(current.name, id));
    nodes(id).forEach(function (n) { n.classList.add("is-selected"); undim(n); });
    within(".edge" + attr("data-from", id)).forEach(function (e) {
      e.classList.add("is-active"); undim(e);
      nodes(e.dataset.to).forEach(undim);
    });

    panel.replaceChildren();
    panel.hidden = false;
    panel.append(el("p", "eyebrow", current.name + " の状態"), el("h2", null, s.label));
    if (s.initial) panel.append(el("span", "tag", "初期状態"));
    if (s.terminal) panel.append(el("span", "tag", "終端"));
    s.violations.forEach(function (v) { panel.append(el("p", "violation", "⚠ 不変条件「" + v + "」を破っています")); });
    (page.questions[id] || []).forEach(function (q) { panel.append(el("p", "violation", "？ 未決: " + q)); });
    (page.terms[id] || []).forEach(function (t) { panel.append(el("p", "sub", t)); });
    if (s.surfaces.length > 0) {
      panel.append(el("h3", null, "見える画面"));
      s.surfaces.forEach(function (g) {
        var group = el("div", "wf-group");
        group.append(el("span", "sub", g.actors.join(", ") + " が見る画面"));
        group.append(document.getElementById(g.template).content.cloneNode(true));
        panel.append(group);
      });
    }
    panel.append(el("h3", null, "できること（" + s.can.length + "）"));
    panel.append(list(s.can, function (c) {
      var li = el("li");
      li.append(el("strong", null, c.action), document.createTextNode(" → " + c.to), el("span", "sub", c.actors.join(", ")));
      return li;
    }));
    panel.append(el("h3", null, "できないこと（" + s.cannot.length + "）"));
    panel.append(list(s.cannot, function (c) {
      var li = el("li");
      li.append(el("strong", null, c.action), el("span", "sub", c.reason));
      return li;
    }));
    var button = el("button", null, "選択を解除");
    button.setAttribute("data-clear", "");
    panel.append(button);
  }

  function selectAction(name) {
    reset(); dimAll();
    within(".edge" + attr("data-action", name)).forEach(function (e) {
      e.classList.add("is-active"); undim(e);
      nodes(e.dataset.from).forEach(undim);
      nodes(e.dataset.to).forEach(undim);
    });
    within(".card" + attr("data-action", name)).forEach(function (c) { c.classList.add("is-selected"); });
  }

  function setMode(mode) {
    var board = current && current.el.querySelector(".board");
    if (!board) return;
    board.dataset.mode = mode;
    within(".modes button").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.mode === mode)); });
  }

  function show(name) {
    var page = document.querySelector(".page" + attr("data-page", name));
    if (!page) return false;
    all(".page").forEach(function (p) { p.hidden = p !== page; });
    all(".tabs a").forEach(function (a) {
      if (a.dataset.tab === name) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    var changed = !current || current.name !== name;
    current = { name: name, el: page };
    if (changed) window.scrollTo(0, 0);
    return true;
  }

  // ページは URL の hash で表す（#/ が一覧、#/<名前> がドメインオブジェクト、#/<名前>/<状態> が状態の選択）。
  // ブラウザの戻る・進むでページを行き来でき、リンクでそのまま共有できる。
  function route() {
    var parts = location.hash.replace(/^#\\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
    var name = parts[0] || data.single || "";
    closePanel();
    if (!show(name)) show(data.single || "");
    if (parts[1] && current && current.name) selectState(parts[1]);
  }

  function selectScenario(name) {
    var page = current && data.pages[current.name];
    var steps = page && page.scenarios[name];
    if (!steps) return;
    reset(); dimAll();
    steps.forEach(function (st) {
      within(".edge" + attr("data-from", st.from) + attr("data-to", st.to) + attr("data-action", st.action)).forEach(function (e) {
        e.classList.add("is-active"); undim(e);
      });
      nodes(st.from).forEach(undim);
      nodes(st.to).forEach(undim);
    });
    within(".scenario-card" + attr("data-scenario", name)).forEach(function (c) { c.classList.add("is-selected"); });
    var board = current.el.querySelector(".board");
    if (board) board.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function activate(target) {
    var scenario = target.closest(".scenario-card");
    if (scenario) return selectScenario(scenario.dataset.scenario);
    var modeButton = target.closest(".modes button");
    if (modeButton) return setMode(modeButton.dataset.mode);
    if (target.closest("[data-clear]")) return reset();
    var node = target.closest(".node");
    if (node) return selectState(node.dataset.state);
    var action = target.closest(".edge,.card[data-action]");
    if (action) return selectAction(action.dataset.action);
  }

  document.addEventListener("click", function (ev) { activate(ev.target); });
  document.addEventListener("change", function (ev) {
    if (!ev.target.classList || !ev.target.classList.contains("viewpoint-select")) return;
    within(".thumb").forEach(function (t) { t.hidden = t.dataset.actor !== ev.target.value; });
  });
  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape") return reset();
    if ((ev.key === "Enter" || ev.key === " ") && ev.target.closest && ev.target.closest(".node,.card[data-action]")) {
      ev.preventDefault();
      activate(ev.target);
    }
  });
  window.addEventListener("hashchange", route);
  route();
})();
`;
