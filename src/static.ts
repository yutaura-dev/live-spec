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
  /** 状態の型の名前（initial に付けた型） */
  readonly stateType: string | null;
  /** 状態の型の項目のうち、ほかのドメインオブジェクトを指すかもしれないもの */
  readonly refs: ReadonlyArray<FieldRef>;
  /** 状態の型のすべての項目（プロパティの表に出す） */
  readonly properties: ReadonlyArray<Property>;
  /** 値ごとの説明（as const のオブジェクトの項目に書いた JSDoc）。項目 → 値 → 説明 */
  readonly valueDocs: Readonly<Record<string, Readonly<Record<string, string>>>>;
  /** データの項目: 値が決まっていない型で、操作・不変条件・目指す状態のどこからも読まれない項目。状態の見分けに使わない */
  readonly dataFields: ReadonlyArray<string>;
}

export interface Property {
  readonly field: string;
  /** 型を書いたとおりの文字 */
  readonly type: string;
  readonly doc: string | null;
  readonly optional: boolean;
}

export interface FieldRef {
  readonly field: string;
  /** 相手の型の名前か、@ref で書いた spec の名前 */
  readonly target: string;
  readonly many: boolean;
  readonly optional: boolean;
  /** @ref で書いたもの（相手が見つからなければ検査結果に出す） */
  readonly explicit: boolean;
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
  const aliases = new Map<string, t.TSType>();
  const constObjects = new Map<string, Array<{ readonly value: string; readonly doc: string | null }>>();
  let initialType: string | null = null;

  for (const node of body) {
    const decl = node.type === "ExportNamedDeclaration" ? node.declaration : node;
    const doc = summaryOf(node.leadingComments);
    if (decl == null) continue;

    if (decl.type === "TSTypeAliasDeclaration" && decl.typeAnnotation.type === "TSTypeLiteral") {
      types.set(decl.id.name, { members: decl.typeAnnotation.members, doc });
    }
    if (decl.type === "TSInterfaceDeclaration") types.set(decl.id.name, { members: decl.body.body, doc });
    if (decl.type === "TSTypeAliasDeclaration" && decl.typeAnnotation.type !== "TSTypeLiteral") aliases.set(decl.id.name, decl.typeAnnotation);
    if (decl.type === "VariableDeclaration") {
      for (const d of decl.declarations) {
        const values = d.id.type === "Identifier" && d.init != null ? constObjectOf(d.init) : null;
        if (values !== null && d.id.type === "Identifier") constObjects.set(d.id.name, values);
      }
    }

    for (const [name, typeName] of valueNamesOf(decl)) {
      if (name === "initial") initialType = typeName;
      if (node.type !== "ExportNamedDeclaration") continue;
      order.push(name);
      if (doc !== null) docs[name] = doc;
      const calls = ensureCallsIn(decl);
      if (calls.length > 0) ensures[name] = calls;
    }
  }

  // 型の別名と as const のオブジェクトをたどって、値の一覧を読む。値の一覧を 1 か所で決めて実装と共有する書き方
  // （const Status = { … } as const と type Status = (typeof Status)[keyof typeof Status]）でも、状態の項目として扱えるようにするため。
  const unwrap = (type: t.TSType): t.TSType => (type.type === "TSParenthesizedType" ? unwrap(type.typeAnnotation) : type);
  const constObjectOfType = (type: t.TSType): string | null => {
    const u = unwrap(type);
    if (u.type !== "TSIndexedAccessType") return null;
    const object = unwrap(u.objectType);
    const index = unwrap(u.indexType);
    if (object.type !== "TSTypeQuery" || object.exprName.type !== "Identifier") return null;
    if (index.type !== "TSTypeOperator" || index.operator !== "keyof") return null;
    return constObjects.has(object.exprName.name) ? object.exprName.name : null;
  };
  const resolve = (type: t.TSType, seen: ReadonlySet<string> = new Set()): { readonly values: ReadonlyArray<FieldValue> | null; readonly constObject: string | null } => {
    const u = unwrap(type);
    if (u.type === "TSTypeReference" && u.typeName.type === "Identifier" && u.typeArguments == null && !seen.has(u.typeName.name)) {
      const alias = aliases.get(u.typeName.name);
      if (alias !== undefined) return resolve(alias, new Set([...seen, u.typeName.name]));
    }
    const constName = constObjectOfType(u);
    if (constName !== null) return { values: constObjects.get(constName)!.map((v) => v.value), constObject: constName };
    return { values: finiteValuesOf(u), constObject: null };
  };

  const stateType = initialType === null ? undefined : types.get(initialType);
  const members = stateType?.members ?? [];
  const fields: Record<string, ReadonlyArray<FieldValue>> = {};
  const valueDocs: Record<string, Record<string, string>> = {};
  const properties: Array<Property> = [];
  for (const m of members) {
    if (m.type !== "TSPropertySignature" || m.typeAnnotation == null) continue;
    const key = m.key.type === "Identifier" ? m.key.name : m.key.type === "StringLiteral" ? m.key.value : null;
    if (key === null) continue;
    const annotation = m.typeAnnotation.typeAnnotation;
    properties.push({ field: key, type: source.slice(annotation.start!, annotation.end!), doc: summaryOf(m.leadingComments), optional: m.optional === true });
    const { values, constObject } = resolve(annotation);
    if (values !== null) fields[key] = values;
    if (constObject !== null) {
      const docsOfValues = Object.fromEntries(constObjects.get(constObject)!.flatMap((v) => (v.doc === null ? [] : [[v.value, v.doc]])));
      if (Object.keys(docsOfValues).length > 0) valueDocs[key] = docsOfValues;
    }
  }
  const read = readFieldNames(body);
  const dataFields = properties.map((p) => p.field).filter((f) => fields[f] === undefined && !read.has(f));
  return {
    order,
    docs,
    fields,
    stateDoc: stateType?.doc ?? null,
    fieldDocs: stateType === undefined ? {} : fieldDocsOf(stateType.members),
    ensures,
    stateType: initialType,
    refs: stateType === undefined ? [] : refsOf(stateType.members),
    properties,
    valueDocs,
    dataFields,
  };
};

const constObjectOf = (init: t.Expression): Array<{ readonly value: string; readonly doc: string | null }> | null => {
  if (init.type !== "TSAsExpression" || init.typeAnnotation.type !== "TSTypeReference") return null;
  if (init.typeAnnotation.typeName.type !== "Identifier" || init.typeAnnotation.typeName.name !== "const") return null;
  if (init.expression.type !== "ObjectExpression") return null;
  const values = init.expression.properties.map((p) =>
    p.type === "ObjectProperty" && p.value.type === "StringLiteral" ? { value: p.value.value, doc: summaryOf(p.leadingComments) } : null,
  );
  return values.every((v) => v !== null) ? values : null;
};

// 状態の項目を読んでいる名前を集める。画面（surface）は表示に使うだけなので数えない。
// 状態以外のオブジェクトの同じ名前の項目も数えてしまうが、そのときは状態の項目として扱う側に倒れるだけなので害はない。
const readFieldNames = (body: ReadonlyArray<t.Statement>): Set<string> => {
  const names = new Set<string>();
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (typeof node !== "object" || node === null || typeof (node as { type?: unknown }).type !== "string") return;
    const n = node as t.Node;
    if ((n.type === "MemberExpression" || n.type === "OptionalMemberExpression") && !n.computed && n.property.type === "Identifier") names.add(n.property.name);
    if ((n.type === "MemberExpression" || n.type === "OptionalMemberExpression") && n.computed && n.property.type === "StringLiteral") names.add(n.property.value);
    if (n.type === "ObjectPattern") {
      for (const p of n.properties) if (p.type === "ObjectProperty" && p.key.type === "Identifier") names.add(p.key.name);
    }
    for (const [key, value] of Object.entries(n)) if (key !== "loc" && key !== "leadingComments" && key !== "trailingComments" && typeof value === "object") visit(value);
  };
  for (const node of body) {
    const decl = node.type === "ExportNamedDeclaration" ? node.declaration : node;
    if (decl?.type === "FunctionDeclaration" && decl.id?.name === "surface") continue;
    if (decl?.type === "VariableDeclaration" && decl.declarations.some((d) => d.id.type === "Identifier" && d.id.name === "surface")) continue;
    visit(node);
  }
  return names;
};

const REF_TAG = /@ref\s+(\S+)/;
const isNullish = (t: t.TSType) => t.type === "TSNullKeyword" || t.type === "TSUndefinedKeyword";

// 項目の型から相手の型の名前と数を読む。ほかの spec の状態の型かどうかは、プロジェクト全体を読んでから決める
// （型の名前だけでは、ただの値の型と見分けられないため）。
const targetOf = (type: t.TSType): { readonly name: string; readonly many: boolean; readonly optional: boolean } | null => {
  const members = type.type === "TSUnionType" ? type.types : [type];
  const rest = members.filter((m) => !isNullish(m));
  if (rest.length !== 1) return null;
  const optional = rest.length !== members.length;
  const only = rest[0]!;
  const nameOf = (r: t.TSType) => (r.type === "TSTypeReference" && r.typeName.type === "Identifier" && r.typeArguments == null ? r.typeName.name : null);
  if (only.type === "TSArrayType") {
    const name = nameOf(only.elementType);
    return name === null ? null : { name, many: true, optional };
  }
  if (only.type === "TSTypeReference" && only.typeName.type === "Identifier" && ["Array", "ReadonlyArray"].includes(only.typeName.name)) {
    const inner = only.typeArguments?.params[0];
    const name = inner === undefined ? null : nameOf(inner);
    return name === null ? null : { name, many: true, optional };
  }
  const name = nameOf(only);
  return name === null ? null : { name, many: false, optional };
};

const refsOf = (members: ReadonlyArray<t.TSTypeElement>): Array<FieldRef> =>
  members.flatMap((m): Array<FieldRef> => {
    if (m.type !== "TSPropertySignature" || m.typeAnnotation == null) return [];
    const field = m.key.type === "Identifier" ? m.key.name : m.key.type === "StringLiteral" ? m.key.value : null;
    if (field === null) return [];
    const tag = m.leadingComments?.map((c) => REF_TAG.exec(c.value)?.[1]).find((x) => x !== undefined);
    if (tag === "none") return [];
    const type = m.typeAnnotation.typeAnnotation;
    const optional = m.optional === true;
    if (tag !== undefined) {
      const many = type.type === "TSArrayType" || (type.type === "TSTypeReference" && type.typeName.type === "Identifier" && ["Array", "ReadonlyArray"].includes(type.typeName.name));
      return [{ field, target: tag, many, optional, explicit: true }];
    }
    const found = targetOf(type);
    return found === null ? [] : [{ field, target: found.name, many: found.many, optional: optional || found.optional, explicit: false }];
  });

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
