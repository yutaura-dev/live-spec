import type { SurfaceNode } from "../surface.ts";
import { esc } from "./escape.ts";

// ワイヤーフレームの描画をサーバ側のこの関数 1 か所にまとめている理由: 状態のパネルと
// wireflow のサムネイルの両方で使うので、描画が 2 か所にあると表示がずれていくため。
export const surfaceToHtml = (node: SurfaceNode, invalidActions: ReadonlyArray<string>): string => {
  const children = (nodes: ReadonlyArray<SurfaceNode>) => nodes.map((c) => surfaceToHtml(c, invalidActions)).join("");
  switch (node.kind) {
    case "screen":
      return `<div class="wf-screen"><div class="wf-title">${esc(node.title)}</div><div class="wf-body">${children(node.children)}</div></div>`;
    case "section":
      return `<div class="wf-section"><span class="wf-label">${esc(node.title)}</span>${children(node.children)}</div>`;
    case "heading":
      return `<div class="wf-heading">${esc(node.text)}</div>`;
    case "text":
      return `<p class="wf-text">${esc(node.text)}</p>`;
    case "field":
      return `<label class="wf-field">${esc(node.label)}<div class="wf-input">${esc(node.value)}</div></label>`;
    case "button": {
      const invalid = node.disabled !== true && node.action !== undefined && invalidActions.includes(node.action);
      const cls = ["wf-button", node.disabled === true ? "is-disabled" : "", invalid ? "is-invalid" : ""].filter(Boolean).join(" ");
      const title = invalid ? ` title="このボタンを押しても ${esc(node.action!)} は実行できません"` : "";
      return `<span class="${cls}"${title}>${esc(node.label)}</span>`;
    }
    case "badge":
      return `<span class="wf-badge">${esc(node.text)}</span>`;
    case "list":
      return `<ul class="wf-list">${node.items.map((i) => `<li>${surfaceToHtml(i, invalidActions)}</li>`).join("")}</ul>`;
    case "code":
      return `<pre class="wf-code" data-language="${esc(node.language)}">${esc(node.text)}</pre>`;
  }
};
