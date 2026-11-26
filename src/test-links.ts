import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { parse } from "@babel/parser";
import { specNameOf } from "./generate.ts";
import type { DomainObject } from "./render/html.ts";
import { UNTESTED } from "./render/review.ts";
import type { Spec } from "./load.ts";
import type { Finding, OmissionHint } from "./model.ts";

const TEST_FILE = /\.test\.[cm]?[jt]sx?$/;

export const collectTestFiles = (paths: ReadonlyArray<string>): Array<string> =>
  paths.flatMap((p) => {
    if (!statSync(p).isDirectory()) return [resolve(p)];
    return readdirSync(p, { withFileTypes: true }).flatMap((e) => {
      if (e.name === "node_modules" || e.name.startsWith(".")) return [];
      const child = join(p, e.name);
      return e.isDirectory() ? collectTestFiles([child]) : TEST_FILE.test(e.name) ? [resolve(child)] : [];
    });
  });

interface Reference {
  readonly spec: string;
  readonly target: string;
  readonly file: string;
  readonly line: number;
}

type Node = { readonly type: string; readonly [key: string]: unknown };
const isNode = (v: unknown): v is Node => typeof v === "object" && v !== null && typeof (v as { type?: unknown }).type === "string";
const walk = (node: unknown, visit: (n: Node) => void): void => {
  if (Array.isArray(node)) return node.forEach((n) => walk(n, visit));
  if (!isNode(node)) return;
  visit(node);
  for (const [key, value] of Object.entries(node)) if (key !== "loc" && typeof value === "object") walk(value, visit);
};
const str = (n: unknown): string | null => (isNode(n) && n.type === "StringLiteral" ? (n.value as string) : null);
const ident = (n: unknown): string | null => (isNode(n) && n.type === "Identifier" ? (n.name as string) : null);

// テストのファイルを実行せずに構文だけで読む理由: テストはプロジェクトのテストランナーの中でしか動かない
// （Electron や DB の準備が要ることもある）ので、live-spec から実行できるとは限らないため。
const referencesIn = (file: string): Array<Reference> => {
  const ast = parse(readFileSync(file, "utf8"), { sourceType: "module", plugins: ["typescript", "jsx"], errorRecovery: true });
  const namespaces = new Map<string, string>();
  const named = new Map<string, { spec: string; name: string }>();
  const helpers = new Set<string>();
  for (const node of ast.program.body) {
    if (node.type !== "ImportDeclaration") continue;
    const from = node.source.value;
    const spec = from.startsWith(".") && /\.spec(\.[cm]?[jt]s)?$/.test(from) ? specNameOf(resolve(dirname(file), from.replace(/(\.spec)$/, "$1.ts"))) : null;
    for (const s of node.specifiers) {
      if (s.type === "ImportNamespaceSpecifier" && spec !== null) namespaces.set(s.local.name, spec);
      if (s.type === "ImportSpecifier") {
        const imported = s.imported.type === "Identifier" ? s.imported.name : s.imported.value;
        if (imported === "specOf") helpers.add(s.local.name);
        else if (spec !== null) named.set(s.local.name, { spec, name: imported });
      }
    }
  }
  const found: Array<Reference> = [];
  walk(ast.program, (n) => {
    if (n.type !== "CallExpression" || !helpers.has(ident(n.callee) ?? "")) return;
    const [first, second] = n.arguments as ReadonlyArray<unknown>;
    const line = (n.loc as { start: { line: number } }).start.line;
    const at = { file: relative(process.cwd(), file), line };
    let spec: string | null = null;
    let action: string | null = null;
    if (isNode(first) && first.type === "MemberExpression" && namespaces.has(ident(first.object) ?? "")) {
      spec = namespaces.get(ident(first.object)!)!;
      action = ident(first.property);
    } else if (named.has(ident(first) ?? "")) {
      ({ spec, name: action } = named.get(ident(first)!)!);
    } else if (namespaces.has(ident(first) ?? "")) {
      spec = namespaces.get(ident(first)!)!;
    }
    if (spec === null) return;
    if (action !== null) {
      const reason = str(second);
      found.push({ spec, target: reason === null ? `action:${action}` : `ensure:${action}:${reason}`, ...at });
      return;
    }
    if (!isNode(second) || second.type !== "ObjectExpression") return;
    for (const p of second.properties as ReadonlyArray<Node>) {
      const key = ident(p.key) ?? str(p.key);
      const value = str(p.value);
      if ((key === "scenario" || key === "invariant") && value !== null) found.push({ spec, target: `${key}:${value}`, ...at });
    }
  });
  return found;
};

const exists = (spec: Spec, target: string): boolean => {
  const [kind, name, reason] = target.split(/:(.*?)(?::(.*))?$/).filter((x) => x !== undefined && x !== "");
  switch (kind) {
    case "action":
      return spec.actions.some(([n]) => n === name);
    case "ensure":
      return spec.actions.some(([n]) => n === name) && (spec.ensures[name!] === undefined || spec.ensures[name!]!.some((e) => e.reason === reason));
    case "scenario":
      return spec.scenarios.some(([n]) => n === name);
    case "invariant":
      return spec.invariants.some(([n]) => n === name);
    default:
      return false;
  }
};

// 条件ごとにテストを求める理由: spec が正本で実装がそれに従うなら、spec の条件のひとつひとつを実装が守っているかを
// 確かめる手段が要る。どのテストも指していない条件は、実装が守っているかが分からない。
// 外しても振る舞いの変わらない条件（ほかの条件と重なっている、型を絞るだけ）は、テストで区別できないので求めない。
export const linkTests = (objects: ReadonlyArray<DomainObject>, testPaths: ReadonlyArray<string>): Array<DomainObject> => {
  const refs = collectTestFiles(testPaths).flatMap(referencesIn);
  return objects.map(({ spec, graph }) => {
    const mine = refs.filter((r) => r.spec === spec.name);
    const tests = mine.filter((r) => exists(spec, r.target)).map(({ target, file, line }) => ({ target, file, line }));
    const unknown: Array<Finding> = mine
      .filter((r) => !exists(spec, r.target))
      .map(({ target, file, line }) => ({ kind: "test-link-unknown", target, file, line }));
    const covered = new Set(tests.map((t) => t.target));
    const untested: Array<OmissionHint> = (graph.ensures ?? [])
      .filter((e) => e.verdict !== "no-effect" && !covered.has(`ensure:${e.action}:${e.reason}`))
      .map((e) => ({
        id: `${UNTESTED}${e.action}:${e.reason}`,
        kind: "untested",
        action: e.action,
        field: null,
        message: `\`${e.action}\` の条件「${e.reason}」を、実装のどのテストも確かめていない（テストの名前に specOf(${e.action}, "${e.reason}") を使うと結べる）`,
      }));
    const ids = new Set(untested.map((h) => h.id));
    const unmatched: Array<Finding> = Object.keys(spec.reviewed)
      .filter((id) => id.startsWith(UNTESTED) && !ids.has(id))
      .map((id) => ({ kind: "reviewed-unmatched", id }));
    return { spec, graph: { ...graph, tests, omissions: [...(graph.omissions ?? []), ...untested], findings: [...graph.findings, ...unknown, ...unmatched] } };
  });
};
