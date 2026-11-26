import { parse } from "@babel/parser";
import type * as t from "@babel/types";

export type FieldValue = string | boolean;

export interface StaticInfo {
  readonly order: ReadonlyArray<string>;
  readonly docs: Readonly<Record<string, string>>;
  readonly fields: Readonly<Record<string, ReadonlyArray<FieldValue>>>;
  readonly stateDoc: string | null;
  readonly fieldDocs: Readonly<Record<string, string>>;
  readonly ensures: Readonly<Record<string, ReadonlyArray<EnsureCall>>>;
}

export interface EnsureCall {
  readonly reason: string;
  readonly line: number;
  /** 後ろの条件のために型を絞る ensure（判別の項目を比べ、後ろで同じ値の別の項目を読む） */
  readonly narrowing?: true;
}

// TypeScript の型チェッカーではなく構文解析にとどめる理由:
// TypeScript 7 の JS API は typescript/unstable/sync しかなく、まだ不安定。
// 構文だけでも「同じファイルの type / interface に書かれたリテラル union」と JSDoc は読める。
// import した型や型の別名をまたぐ解決が必要になったら、この関数だけを差し替える。
export const analyze = (source: string): StaticInfo => {
  const file = parse(source, { sourceType: "module", plugins: ["typescript"] });
  const body = file.program.body;
  const ensures: Record<string, ReadonlyArray<EnsureCall>> = {};
  const order: Array<string> = [];
  const docs: Record<string, string> = {};
  const types = new Map<string, { members: ReadonlyArray<t.TSTypeElement>; doc: string | null }>();
  let initialType: string | null = null;

  for (const node of body) {
    const decl = node.type === "ExportNamedDeclaration" ? node.declaration : node;
    const doc = summaryOf(node.leadingComments);
    if (decl == null) continue;

    if (decl.type === "TSTypeAliasDeclaration" && decl.typeAnnotation.type === "TSTypeLiteral") {
      types.set(decl.id.name, { members: decl.typeAnnotation.members, doc });
    }
    if (decl.type === "TSInterfaceDeclaration") types.set(decl.id.name, { members: decl.body.body, doc });

    for (const [name, typeName] of valueNamesOf(decl)) {
      if (name === "initial") initialType = typeName;
      if (node.type !== "ExportNamedDeclaration") continue;
      order.push(name);
      if (doc !== null) docs[name] = doc;
      const calls = ensureCallsIn(decl);
      if (calls.length > 0) ensures[name] = calls;
    }
  }

  const stateType = initialType === null ? undefined : types.get(initialType);
  return {
    order,
    docs,
    fields: stateType === undefined ? {} : fieldsOf(stateType.members),
    stateDoc: stateType?.doc ?? null,
    fieldDocs: stateType === undefined ? {} : fieldDocsOf(stateType.members),
    ensures,
  };
};

// 理由が文字列リテラル（または式を含まないテンプレート）の ensure だけを集める。
// 理由を式で組み立てている ensure は、どの理由のときに外せばよいかを実行前に決められないため。
const ensureCallsIn = (root: t.Node): Array<EnsureCall> => {
  const calls: Array<EnsureCall> = [];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (typeof node !== "object" || node === null || !("type" in node)) return;
    const n = node as t.Node;
    if (n.type === "CallExpression" && n.callee.type === "Identifier" && n.callee.name === "ensure") {
      const arg = n.arguments[1];
      const reason =
        arg?.type === "StringLiteral"
          ? arg.value
          : arg?.type === "TemplateLiteral" && arg.expressions.length === 0
            ? arg.quasis.map((q) => q.value.cooked ?? "").join("")
            : null;
      if (reason !== null && n.loc != null) {
        calls.push({ reason, line: n.loc.start.line, ...(narrowsType(root, n) ? { narrowing: true as const } : {}) });
      }
    }
    for (const [key, value] of Object.entries(n)) {
      if (key === "loc" || key.endsWith("Comments")) continue;
      visit(value);
    }
  };
  visit(root);
  return calls;
};

// 判別 union の登場人物（{ kind: "human"; via: … } | { kind: "worker" }）では、via を読むために先に kind で型を絞る。
// この ensure は外しても振る舞いが変わらないことが多いが、消すと型が通らないので「重なり」とは別に扱う。
// 型チェッカーを使わず構文で見分けるので、比べた値と同じ名前の値の、別の項目を後ろで読んでいるかだけを見る。
const narrowsType = (root: t.Node, call: t.CallExpression): boolean => {
  const cond = call.arguments[0];
  if (cond?.type !== "BinaryExpression" || (cond.operator !== "===" && cond.operator !== "!==")) return false;
  const member = cond.right.type === "StringLiteral" ? cond.left : cond.left.type === "StringLiteral" ? cond.right : null;
  if (member?.type !== "MemberExpression" || member.object.type !== "Identifier" || member.property.type !== "Identifier") return false;
  const object = member.object.name;
  const discriminant = member.property.name;
  let found = false;
  const visit = (node: unknown): void => {
    if (found) return;
    if (Array.isArray(node)) return node.forEach(visit);
    if (typeof node !== "object" || node === null || !("type" in node)) return;
    const n = node as t.Node;
    if (
      n.type === "MemberExpression" &&
      n.start! > call.end! &&
      n.object.type === "Identifier" &&
      n.object.name === object &&
      n.property.type === "Identifier" &&
      n.property.name !== discriminant
    ) {
      found = true;
      return;
    }
    for (const [key, value] of Object.entries(n)) {
      if (key === "loc" || key.endsWith("Comments")) continue;
      visit(value);
    }
  };
  visit(root);
  return found;
};

const valueNamesOf = (decl: t.Node): ReadonlyArray<readonly [name: string, typeName: string | null]> => {
  if (decl.type === "FunctionDeclaration" && decl.id != null) return [[decl.id.name, null]];
  if (decl.type !== "VariableDeclaration") return [];
  return decl.declarations.flatMap((d) => {
    if (d.id.type !== "Identifier") return [];
    const ann = d.id.typeAnnotation;
    const ref = ann?.type === "TSTypeAnnotation" && ann.typeAnnotation.type === "TSTypeReference" ? ann.typeAnnotation : null;
    const typeName = ref !== null && ref.typeName.type === "Identifier" ? ref.typeName.name : null;
    return [[d.id.name, typeName] as const];
  });
};

const fieldsOf = (members: ReadonlyArray<t.TSTypeElement>): Record<string, ReadonlyArray<FieldValue>> => {
  const fields: Record<string, ReadonlyArray<FieldValue>> = {};
  for (const m of members) {
    if (m.type !== "TSPropertySignature" || m.typeAnnotation == null) continue;
    const key = m.key.type === "Identifier" ? m.key.name : m.key.type === "StringLiteral" ? m.key.value : null;
    const values = finiteValuesOf(m.typeAnnotation.typeAnnotation);
    if (key !== null && values !== null) fields[key] = values;
  }
  return fields;
};

const fieldDocsOf = (members: ReadonlyArray<t.TSTypeElement>): Record<string, string> => {
  const docs: Record<string, string> = {};
  for (const m of members) {
    if (m.type !== "TSPropertySignature") continue;
    const key = m.key.type === "Identifier" ? m.key.name : m.key.type === "StringLiteral" ? m.key.value : null;
    const doc = summaryOf(m.leadingComments);
    if (key !== null && doc !== null) docs[key] = doc;
  }
  return docs;
};

const finiteValuesOf = (type: t.TSType): ReadonlyArray<FieldValue> | null => {
  if (type.type === "TSBooleanKeyword") return [false, true];
  const members = type.type === "TSUnionType" ? type.types : [type];
  const values = members.map((m) => (m.type === "TSLiteralType" && m.literal.type === "StringLiteral" ? m.literal.value : null));
  return values.every((v): v is string => v !== null) ? values : null;
};

// 最初の段落（空行まで）を説明文にする理由: 1 行目だけを取ると、複数行にわたる文が途中で切れてしまうため。
const summaryOf = (comments: ReadonlyArray<t.Comment> | null | undefined): string | null => {
  const jsdoc = comments?.findLast((c) => c.type === "CommentBlock" && c.value.startsWith("*"));
  if (jsdoc === undefined) return null;
  const lines = jsdoc.value
    .slice(1)
    .split("\n")
    .map((line) => line.replace(/^\s*\*?\s?/, "").trim());
  const start = lines.findIndex((line) => line !== "");
  if (start === -1) return null;
  const end = lines.indexOf("", start);
  return (end === -1 ? lines.slice(start) : lines.slice(start, end)).reduce((text, line) =>
    isCjk(text.at(-1)) || isCjk(line[0]) ? text + line : `${text} ${line}`,
  );
};

// 日本語の行のあいだに空白を入れない理由: JSDoc の折り返しは表示上の都合なので、日本語では空白が入ると文が不自然に途切れる。
const isCjk = (ch: string | undefined) => ch !== undefined && (ch.codePointAt(0) ?? 0) > 0x2e7f;
