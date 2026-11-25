import type { Spec } from "../load.ts";
import type { Graph } from "../model.ts";
import { layout, type LaidOutEdge, type LaidOutNode } from "./layout.ts";
import { describeFinding, formatEffect } from "./markdown.ts";
import { summarizeActions, summarizeStates, type ActionSummary } from "./summary.ts";

export const renderHtml = async (spec: Spec, graph: Graph): Promise<string> => {
  const l = await layout(graph);
  const actions = summarizeActions(spec, graph);
  const labelOf = (id: string) => graph.states.find((s) => s.id === id)?.label ?? id;
  const initial = graph.states.find((s) => s.initial);
  const terminal = new Set(graph.states.filter((s) => s.terminal).map((s) => s.id));
  const violating = new Set(graph.findings.flatMap((f) => (f.kind === "invariant-violation" ? [f.state] : [])));
  const data = {
    states: summarizeStates(spec, graph),
    notAllowed: graph.findings.flatMap((f) => (f.kind === "surface-action-not-allowed" ? [{ state: f.state, actor: f.actor, action: f.action }] : [])),
  };

  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(spec.name)} — 仕様書</title>
<style>${CSS}</style>
</head>
<body>
<header class="top">
  <div>
    <p class="eyebrow">仕様書</p>
    <h1>${esc(spec.name)}</h1>
    ${spec.stateDoc === null ? "" : `<p class="lead">${esc(spec.stateDoc)}</p>`}
  </div>
  <dl class="stats">
    <div><dt>状態</dt><dd>${graph.states.length}</dd></div>
    <div><dt>操作</dt><dd>${actions.length}</dd></div>
    <div><dt>検査</dt><dd class="${graph.findings.length === 0 ? "ok" : "warn"}">${graph.findings.length === 0 ? "OK" : graph.findings.length}</dd></div>
  </dl>
</header>
<main>
  <section class="board" aria-label="状態遷移図">
    <p class="hint">状態をクリックすると、その状態でできること・できないことを表示します。矢印のラベルや操作カードをクリックすると、その操作の遷移を強調します。Esc で解除。</p>
    <div class="diagram">
      <svg viewBox="0 0 ${l.width + 24} ${l.height}" width="${l.width + 24}" height="${l.height}" role="img" aria-label="${esc(spec.name)} の状態遷移図">
        <defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z"/></marker></defs>
        <g transform="translate(24 0)">
        ${l.edges.map(edgeSvg).join("\n        ")}
        ${l.nodes.map((n) => nodeSvg(n, n.id === initial?.id, terminal.has(n.id), violating.has(n.id))).join("\n        ")}
        </g>
      </svg>
    </div>
    <aside class="panel" id="panel" aria-live="polite" hidden></aside>
  </section>
  <section class="actions">
    <h2>操作</h2>
    <div class="cards">
      ${actions.map(actionCard).join("\n      ")}
    </div>
  </section>
  <section class="findings">
    <h2>検査結果</h2>
    ${
      graph.findings.length === 0
        ? '<p class="ok-line">問題は見つかりませんでした。</p>'
        : `<ul>${graph.findings.map((f) => `<li>${esc(describeFinding(f, labelOf))}</li>`).join("")}</ul>`
    }
  </section>
</main>
<script type="application/json" id="live-spec-data">${jsonForScript(data)}</script>
<script>${CLIENT}</script>
</body>
</html>
`;
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

const nodeSvg = (n: LaidOutNode, initial: boolean, terminal: boolean, violation: boolean) => {
  const cls = ["node", initial ? "initial" : "", terminal ? "terminal" : "", violation ? "violation" : ""].filter(Boolean).join(" ");
  const cy = n.y + n.height / 2;
  const start = initial
    ? `<circle class="start" cx="${n.x - 18}" cy="${cy}" r="5"/><path class="start-line" d="M${n.x - 13},${cy} L${n.x - 2},${cy}" marker-end="url(#arrow)"/>`
    : "";
  const inner = terminal
    ? `<rect class="inner" x="${n.x + 3}" y="${n.y + 3}" width="${n.width - 6}" height="${n.height - 6}" rx="7"/>`
    : "";
  return `${start}<g class="${cls}" data-state="${esc(n.id)}" tabindex="0" role="button" aria-label="状態 ${esc(n.label)}"><rect x="${n.x}" y="${n.y}" width="${n.width}" height="${n.height}" rx="10"/>${inner}<text x="${n.x + n.width / 2}" y="${cy}">${esc(n.label)}</text></g>`;
};

const edgeSvg = (e: LaidOutEdge) => {
  const d = e.points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
  const lb = e.label;
  return `<g class="edge" data-action="${esc(e.action)}" data-from="${esc(e.from)}" data-to="${esc(e.to)}"><path d="${d}" marker-end="url(#arrow)"/><g class="edge-label"><rect x="${lb.x}" y="${lb.y}" width="${lb.width}" height="${lb.height}" rx="4"/><text x="${lb.x + lb.width / 2}" y="${lb.y + lb.height / 2}">${esc(e.action)}</text></g></g>`;
};

const actionCard = (a: ActionSummary) => {
  const others =
    a.othersReasons.length === 0 ? "" : `<span class="muted">ほかの人は「${a.othersReasons.map(esc).join("」「")}」</span>`;
  const who =
    a.capable.length === 0
      ? '<span class="muted">なし（どの状態でも誰も実行できない）</span>'
      : `${a.capable.map((c) => `<span class="chip">${esc(c)}</span>`).join("")}${others}`;
  const when =
    a.when.length === 0
      ? '<span class="muted">なし</span>'
      : a.when.map((w) => `<span class="flow">${esc(w.from)} → ${esc(w.to)}</span>`).join("");
  const blocked = a.blocked.map(
    (b) => `<li><span class="reason">${esc(b.reason)}</span> ${b.states.map((s) => `<span class="state">${esc(s)}</span>`).join("")}</li>`,
  );
  const whenNot = blocked.length === 0 ? '<span class="muted">なし</span>' : `<ul>${blocked.join("")}</ul>`;
  const effect = formatEffect(a);
  return `<article class="card" data-action="${esc(a.name)}" tabindex="0">
        <h3>${a.summary === null ? "" : `${esc(a.summary)} `}<code>${esc(a.name)}</code></h3>
        <dl>
          <dt>できる人</dt><dd>${who}</dd>
          <dt>できるとき</dt><dd>${when}</dd>
          <dt>できないとき</dt><dd>${whenNot}</dd>
          ${a.inputReasons.length === 0 ? "" : `<dt>できない入力</dt><dd><ul>${a.inputReasons.map((r) => `<li><span class="reason">${esc(r.reason)}</span> <span class="state">${esc(r.input)}</span></li>`).join("")}</ul></dd>`}
          ${effect === "" ? "" : `<dt>結果</dt><dd>${esc(effect)}</dd>`}
        </dl>
      </article>`;
};

const ESCAPES: Readonly<Record<string, string>> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESCAPES[c]!);

// < などをエスケープする理由: spec の文字列に "</script>" が含まれていても、
// 埋め込んだ JSON が script 要素を途中で閉じないようにするため。
const jsonForScript = (data: unknown) =>
  JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/\u{2028}/gu, "\\u2028")
    .replace(/\u{2029}/gu, "\\u2029");

const CSS = `
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

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function all(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }
  function attr(name, value) { return "[" + name + '="' + CSS.escape(value) + '"]'; }
  function clear() {
    all(".is-selected,.is-active,.is-dim").forEach(function (n) { n.classList.remove("is-selected", "is-active", "is-dim"); });
  }
  function dimAll() { all(".node,.edge").forEach(function (n) { n.classList.add("is-dim"); }); }
  function undim(n) { if (n) n.classList.remove("is-dim"); }
  function reset() {
    clear(); panel.replaceChildren(); panel.hidden = true;
    if (location.hash) history.replaceState(null, "", location.pathname + location.search);
  }

  function list(items, render) {
    var ul = el("ul");
    if (items.length === 0) ul.append(el("li", "sub", "なし"));
    items.forEach(function (item) { ul.append(render(item)); });
    return ul;
  }

  // ワイヤーフレームも textContent で組み立てる（文言は spec 由来の文字列なので）。
  function renderSurface(node, invalid) {
    var children = function (parent, list) { list.forEach(function (c) { parent.append(renderSurface(c, invalid)); }); return parent; };
    switch (node.kind) {
      case "screen": {
        var screen = el("div", "wf-screen");
        screen.append(el("div", "wf-title", node.title), children(el("div", "wf-body"), node.children));
        return screen;
      }
      case "section": {
        var section = el("div", "wf-section");
        section.append(el("span", "wf-label", node.title));
        return children(section, node.children);
      }
      case "heading": return el("div", "wf-heading", node.text);
      case "text": return el("p", "wf-text", node.text);
      case "field": {
        var field = el("label", "wf-field", node.label);
        field.append(el("div", "wf-input", node.value));
        return field;
      }
      case "button": {
        var cls = "wf-button" + (node.disabled ? " is-disabled" : "") + (!node.disabled && invalid.indexOf(node.action) >= 0 ? " is-invalid" : "");
        var button = el("span", cls, node.label);
        if (cls.indexOf("is-invalid") >= 0) button.title = "このボタンを押しても " + node.action + " は実行できません";
        return button;
      }
      case "badge": return el("span", "wf-badge", node.text);
      case "list": {
        var ul = el("ul", "wf-list");
        node.items.forEach(function (item) { var li = el("li"); li.append(renderSurface(item, invalid)); ul.append(li); });
        return ul;
      }
      case "code": {
        var pre = el("pre", "wf-code", node.text);
        pre.setAttribute("data-language", node.language);
        return pre;
      }
      default: return el("span", "sub", "（未対応の要素: " + String(node.kind) + "）");
    }
  }

  function selectState(id) {
    var s = data.states.find(function (x) { return x.id === id; });
    if (!s) return;
    clear(); dimAll();
    // 選択を URL の hash に残す理由: --serve で自動再読み込みしたあとも、同じ状態を見続けられるようにするため。
    history.replaceState(null, "", "#state-" + encodeURIComponent(id));
    var node = document.querySelector(".node" + attr("data-state", id));
    node.classList.add("is-selected"); undim(node);
    all(".edge" + attr("data-from", id)).forEach(function (e) {
      e.classList.add("is-active"); undim(e);
      undim(document.querySelector(".node" + attr("data-state", e.dataset.to)));
    });

    panel.replaceChildren();
    panel.hidden = false;
    panel.append(el("p", "eyebrow", "状態"), el("h2", null, s.label));
    if (s.initial) panel.append(el("span", "tag", "初期状態"));
    if (s.terminal) panel.append(el("span", "tag", "終端"));
    s.violations.forEach(function (v) { panel.append(el("p", "violation", "⚠ 不変条件「" + v + "」を破っています")); });
    if (s.surfaces.length > 0) {
      panel.append(el("h3", null, "見える画面"));
      s.surfaces.forEach(function (g) {
        var group = el("div", "wf-group");
        group.append(el("span", "sub", g.actors.join(", ") + " が見る画面"));
        var invalid = data.notAllowed.filter(function (n) { return n.state === s.id && g.actors.indexOf(n.actor) >= 0; })
          .map(function (n) { return n.action; });
        group.append(renderSurface(g.surface, invalid));
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
    all(".edge" + attr("data-action", name)).forEach(function (e) {
      e.classList.add("is-active"); undim(e);
      undim(document.querySelector(".node" + attr("data-state", e.dataset.from)));
      undim(document.querySelector(".node" + attr("data-state", e.dataset.to)));
    });
    all(".card" + attr("data-action", name)).forEach(function (c) { c.classList.add("is-selected"); });
  }

  function activate(target) {
    if (target.closest("[data-clear]")) return reset();
    var node = target.closest(".node");
    if (node) return selectState(node.dataset.state);
    var action = target.closest(".edge,.card");
    if (action) return selectAction(action.dataset.action);
  }

  document.addEventListener("click", function (ev) { activate(ev.target); });
  var match = /^#state-(.+)$/.exec(location.hash);
  if (match) selectState(decodeURIComponent(match[1]));
  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape") return reset();
    if ((ev.key === "Enter" || ev.key === " ") && ev.target.closest && ev.target.closest(".node,.card")) {
      ev.preventDefault();
      activate(ev.target);
    }
  });
})();
`;
