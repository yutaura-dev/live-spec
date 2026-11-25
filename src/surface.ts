export type SurfaceNode =
  | { readonly kind: "screen"; readonly title: string; readonly children: ReadonlyArray<SurfaceNode> }
  | { readonly kind: "section"; readonly title: string; readonly children: ReadonlyArray<SurfaceNode> }
  | { readonly kind: "heading"; readonly text: string }
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "field"; readonly label: string; readonly value: string }
  | { readonly kind: "button"; readonly label: string; readonly action?: string; readonly disabled?: true }
  | { readonly kind: "badge"; readonly text: string }
  | { readonly kind: "list"; readonly items: ReadonlyArray<SurfaceNode> }
  | { readonly kind: "code"; readonly language: string; readonly text: string };

// false / null / undefined を子として受け付ける理由: `cond && ui.button(...)` のように、
// 状態に応じて要素を出し分ける書き方をそのまま使えるようにするため。
export type Child = SurfaceNode | false | null | undefined;

const present = (children: ReadonlyArray<Child>): Array<SurfaceNode> =>
  children.filter((c): c is SurfaceNode => c !== false && c !== null && c !== undefined);

// ボタンに操作の関数そのものを受け取る理由: 操作名を文字列で書くと、打ち間違いやリネームの
// 追従漏れが起きても気づけない。関数なら TypeScript が存在を保証し、名前は実行時に fn.name で得られる。
type AnyAction = (...args: never) => unknown;

export const ui = {
  screen: (title: string, ...children: ReadonlyArray<Child>): SurfaceNode => ({ kind: "screen", title, children: present(children) }),
  section: (title: string, ...children: ReadonlyArray<Child>): SurfaceNode => ({
    kind: "section",
    title,
    children: present(children),
  }),
  heading: (text: string): SurfaceNode => ({ kind: "heading", text }),
  text: (text: string): SurfaceNode => ({ kind: "text", text }),
  field: (label: string, value = ""): SurfaceNode => ({ kind: "field", label, value }),
  button: (label: string, action?: AnyAction, options: { readonly disabled?: boolean } = {}): SurfaceNode => ({
    kind: "button",
    label,
    ...(action === undefined ? {} : { action: action.name }),
    ...(options.disabled === true ? { disabled: true as const } : {}),
  }),
  badge: (text: string): SurfaceNode => ({ kind: "badge", text }),
  list: (...items: ReadonlyArray<Child>): SurfaceNode => ({ kind: "list", items: present(items) }),
};

export const api = {
  request: (method: string, path: string, body?: unknown): SurfaceNode => ({
    kind: "code",
    language: "http",
    text: body === undefined ? `${method} ${path}` : `${method} ${path}\n${JSON.stringify(body, null, 2)}`,
  }),
  response: (status: number, body?: unknown): SurfaceNode => ({
    kind: "code",
    language: "http",
    text: body === undefined ? `HTTP ${status}` : `HTTP ${status}\n${JSON.stringify(body, null, 2)}`,
  }),
};

export const cli = {
  output: (text: string): SurfaceNode => ({ kind: "code", language: "terminal", text }),
};

export const buttonsOf = (node: SurfaceNode): Array<Extract<SurfaceNode, { kind: "button" }>> => {
  if (node.kind === "button") return [node];
  if (node.kind === "screen" || node.kind === "section") return node.children.flatMap(buttonsOf);
  if (node.kind === "list") return node.items.flatMap(buttonsOf);
  return [];
};
