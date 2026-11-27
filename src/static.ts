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
  /** 作ったときに決まる値の項目: 値の一覧を持ち、条件で読むが、どの操作も書き換えない項目。値ごとに初期状態を作って探索する */
  readonly creationFields: ReadonlyArray<string>;
  /** どれかの操作が戻り値で書く項目 */
  readonly writtenFields: ReadonlyArray<string>;
  /** 操作・不変条件・目指す状態の関数で読まれる名前（値オブジェクトの中の項目も含む） */
  readonly readFields: ReadonlyArray<string>;
  /** export した型と、その項目（値オブジェクトのファイルで、値オブジェクトの型を読むのに使う） */
  readonly exportedTypes: ReadonlyArray<{ readonly name: string; readonly doc: string | null; readonly properties: ReadonlyArray<Property> }>;
}

export interface Property {
  /** 項目の名前。判別 union の種類の行では「type = human」 */
  readonly field: string;
  /** 型を書いたとおりの文字（種類の行では空） */
  readonly type: string;
  readonly doc: string | null;
  readonly optional: boolean;
  /** 値の一覧（文字列の union など、値が決まっている型のとき） */
  readonly values: ReadonlyArray<FieldValue> | null;
  /** オブジェクトの型の項目を展開した子の項目（判別 union なら種類ごとの行） */
  readonly children: ReadonlyArray<Property>;
  /** 判別 union の種類の行 */
  readonly variant?: true;
  /** 値ごとの説明（as const のオブジェクトの各値の JSDoc）。値 → 説明 */
  readonly valueDocs?: Readonly<Record<string, string>>;
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
  const aliasStarts = new Map<string, number>();
  const constObjects = new Map<string, Array<{ readonly value: string; readonly doc: string | null }>>();
  let initialType: string | null = null;
  const exportedTypeDecls: Array<{ readonly name: string; readonly doc: string | null; readonly decl: t.TSTypeAliasDeclaration | t.TSInterfaceDeclaration }> = [];

  for (const node of body) {
    const decl = node.type === "ExportNamedDeclaration" ? node.declaration : node;
    const doc = summaryOf(node.leadingComments);
    if (decl == null) continue;

    if (decl.type === "TSTypeAliasDeclaration" && decl.typeAnnotation.type === "TSTypeLiteral") {
      types.set(decl.id.name, { members: decl.typeAnnotation.members, doc });
    }
    if (decl.type === "TSInterfaceDeclaration") types.set(decl.id.name, { members: decl.body.body, doc });
    if (node.type === "ExportNamedDeclaration" && (decl.type === "TSTypeAliasDeclaration" || decl.type === "TSInterfaceDeclaration")) {
      exportedTypeDecls.push({ name: decl.id.name, doc, decl });
    }
    if (decl.type === "TSTypeAliasDeclaration" && decl.typeAnnotation.type !== "TSTypeLiteral") {
      aliases.set(decl.id.name, decl.typeAnnotation);
      aliasStarts.set(decl.id.name, decl.id.end!);
    }
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

  // オブジェクトの型の項目を、子の項目として展開する（プロパティの表で、入れ子の行として見せるため）。判別 union は、
  // どの種類にもある文字列リテラルの項目を判別子として、種類ごとの行の下に並べる。同じ型に戻ったら止め、深さも 4 段までにする。
  const MAX_DEPTH = 4;
  const valueDocsOf = (constObject: string | null): { valueDocs?: Record<string, string> } => {
    const docs = constObject === null ? {} : Object.fromEntries(constObjects.get(constObject)!.flatMap((v) => (v.doc === null ? [] : [[v.value, v.doc]])));
    return Object.keys(docs).length === 0 ? {} : { valueDocs: docs };
  };
  // 判別 union の種類ごとの JSDoc は、Babel では前後の種類や union 全体の注釈として付くので、位置で探す。
  // 種類の直前にあり、1 つ前の種類（最初の種類なら型の名前）より後ろにある JSDoc を、その種類の説明とする。
  const docBetween = (after: number, before: number): string | null =>
    summaryOf((file.comments ?? []).filter((c) => c.start! >= after && c.end! <= before));
  const nonNull = (type: t.TSType): ReadonlyArray<t.TSType> => {
    const u = unwrap(type);
    return (u.type === "TSUnionType" ? u.types : [u]).map(unwrap).filter((m) => m.type !== "TSNullKeyword" && m.type !== "TSUndefinedKeyword");
  };
  const membersOfType = (type: t.TSType, seen: ReadonlySet<string>): { readonly members: ReadonlyArray<t.TSTypeElement>; readonly seen: ReadonlySet<string> } | null => {
    if (type.type === "TSTypeLiteral") return { members: type.members, seen };
    if (type.type === "TSTypeReference" && type.typeName.type === "Identifier" && !seen.has(type.typeName.name)) {
      const name = type.typeName.name;
      const literal = types.get(name);
      if (literal !== undefined) return { members: literal.members, seen: new Set([...seen, name]) };
      const alias = aliases.get(name);
      if (alias !== undefined) {
        const only = nonNull(alias);
        return only.length === 1 ? membersOfType(only[0]!, new Set([...seen, name])) : null;
      }
    }
    return null;
  };
  const expand = (type: t.TSType, seen: ReadonlySet<string>, depth: number, after: number): Array<Property> => {
    if (depth > MAX_DEPTH) return [];
    let options = nonNull(type);
    if (options.length === 1) {
      const only = options[0]!;
      const element = only.type === "TSArrayType" ? only.elementType : only.type === "TSTypeReference" && only.typeName.type === "Identifier" && ["Array", "ReadonlyArray"].includes(only.typeName.name) ? only.typeArguments?.params[0] : undefined;
      if (element !== undefined) return expand(element, seen, depth, after);
      if (only.type === "TSTypeReference" && only.typeName.type === "Identifier" && aliases.has(only.typeName.name) && !seen.has(only.typeName.name)) {
        const name = only.typeName.name;
        const inner = nonNull(aliases.get(name)!);
        if (inner.length > 1) {
          options = inner;
          seen = new Set([...seen, name]);
          after = aliasStarts.get(name)!;
        }
      }
    }
    if (options.length > 1) {
      const cases = options.map((o) => ({ node: o, found: membersOfType(o, seen) }));
      if (cases.some((c) => c.found === null)) return [];
      const literalOf = (members: ReadonlyArray<t.TSTypeElement>, key: string) => {
        const m = members.find((x) => x.type === "TSPropertySignature" && x.key.type === "Identifier" && x.key.name === key);
        const a = m?.type === "TSPropertySignature" ? m.typeAnnotation?.typeAnnotation : undefined;
        return a?.type === "TSLiteralType" && a.literal.type === "StringLiteral" ? a.literal.value : null;
      };
      const keys = cases[0]!.found!.members.flatMap((m) => (m.type === "TSPropertySignature" && m.key.type === "Identifier" ? [m.key.name] : []));
      const discriminant = keys.find((k) => cases.every((c) => literalOf(c.found!.members, k) !== null));
      if (discriminant === undefined) return [];
      return cases.map((c, i) => ({
        field: `${discriminant} = ${literalOf(c.found!.members, discriminant)}`,
        type: "",
        doc: docBetween(i === 0 ? after : cases[i - 1]!.node.end!, c.node.start!),
        optional: false,
        values: null,
        variant: true as const,
        children: propertiesOf(c.found!.members.filter((m) => !(m.type === "TSPropertySignature" && m.key.type === "Identifier" && m.key.name === discriminant)), c.found!.seen, depth + 1),
      }));
    }
    const found = options.length === 1 ? membersOfType(options[0]!, seen) : null;
    return found === null ? [] : propertiesOf(found.members, found.seen, depth);
  };
  function propertiesOf(members: ReadonlyArray<t.TSTypeElement>, seen: ReadonlySet<string>, depth: number): Array<Property> {
    return members.flatMap((m): Array<Property> => {
      if (m.type !== "TSPropertySignature" || m.typeAnnotation == null) return [];
      const key = m.key.type === "Identifier" ? m.key.name : m.key.type === "StringLiteral" ? m.key.value : null;
      if (key === null) return [];
      const annotation = m.typeAnnotation.typeAnnotation;
      return [
        {
          field: key,
          type: source.slice(annotation.start!, annotation.end!),
          doc: summaryOf(m.leadingComments),
          optional: m.optional === true,
          values: resolve(annotation).values,
          ...valueDocsOf(resolve(annotation).constObject),
          children: expand(annotation, seen, depth + 1, m.key.end!),
        },
      ];
    });
  }

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
    const { values, constObject } = resolve(annotation);
    properties.push({
      field: key,
      type: source.slice(annotation.start!, annotation.end!),
      doc: summaryOf(m.leadingComments),
      optional: m.optional === true,
      values,
      children: expand(annotation, new Set(initialType === null ? [] : [initialType]), 1, m.key.end!),
    });
    if (values !== null) fields[key] = values;
    if (constObject !== null) {
      const docsOfValues = Object.fromEntries(constObjects.get(constObject)!.flatMap((v) => (v.doc === null ? [] : [[v.value, v.doc]])));
      if (Object.keys(docsOfValues).length > 0) valueDocs[key] = docsOfValues;
    }
  }
  const read = readFieldNames(body);
  const written = writtenFieldNames(body);
  // 値の一覧を持つ項目を操作が書き換えているのに誰も読まないのは、条件の書き忘れのことが多いので、データにせず
  // 「どの可否にも影響しない項目」の候補に残す。
  const dataFields = properties.map((p) => p.field).filter((f) => !read.has(f) && (fields[f] === undefined || !written.has(f)));
  const creationFields = properties.map((p) => p.field).filter((f) => fields[f] !== undefined && read.has(f) && !written.has(f));
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
    creationFields,
    writtenFields: properties.map((p) => p.field).filter((f) => written.has(f)),
    readFields: [...read].sort(),
    exportedTypes: exportedTypeDecls.map(({ name, doc, decl }) => ({
      name,
      doc,
      properties:
        decl.type === "TSInterfaceDeclaration"
          ? propertiesOf(decl.body.body, new Set([name]), 1)
          : decl.typeAnnotation.type === "TSTypeLiteral"
            ? propertiesOf(decl.typeAnnotation.members, new Set([name]), 1)
            : expand(decl.typeAnnotation, new Set([name]), 1, decl.id.end!),
    })),
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

// 操作が戻り値で書く項目を集める。{ ...t, status: "done" } の status のように、オブジェクトの書き方のキーを数える
// （...t で写すだけの項目は書き換えではない）。状態の型を返す関数（操作）だけを見るのが正確だが、構文だけでは
// 見分けられないので、export した関数をすべて見る。画面（surface）は戻り値が画面なので除く。
const writtenFieldNames = (body: ReadonlyArray<t.Statement>): Set<string> => {
  const names = new Set<string>();
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (typeof node !== "object" || node === null || typeof (node as { type?: unknown }).type !== "string") return;
    const n = node as t.Node;
    if (n.type === "ObjectExpression") {
      for (const p of n.properties) {
        if (p.type !== "ObjectProperty" || p.computed) continue;
        if (p.key.type === "Identifier") names.add(p.key.name);
        if (p.key.type === "StringLiteral") names.add(p.key.value);
      }
    }
    for (const [key, value] of Object.entries(n)) if (key !== "loc" && key !== "leadingComments" && key !== "trailingComments" && typeof value === "object") visit(value);
  };
  for (const node of body) {
    if (node.type !== "ExportNamedDeclaration" || node.declaration == null) continue;
    const decl = node.declaration;
    // 作る操作（initial）は状態の項目をすべて書くので数えない。数えると、作ったときに決まる値（種類など）まで
    // 「操作が書き換える項目」になり、値ごとの初期状態の探索や、データの見分けが効かなくなるため。
    const skip = (name: string | undefined) => name === "surface" || name === "initial";
    if (decl.type === "FunctionDeclaration" && !skip(decl.id?.name)) visit(decl.body);
    if (decl.type === "VariableDeclaration") {
      for (const d of decl.declarations) {
        if (d.id.type === "Identifier" && !skip(d.id.name) && (d.init?.type === "ArrowFunctionExpression" || d.init?.type === "FunctionExpression")) visit(d.init.body);
      }
    }
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
  if (decl.type === "FunctionDeclaration" && decl.id != null) {
    // 作る操作（export function initial(user): Article）は、戻り値の型が状態の型になる。
    const ret = decl.returnType?.type === "TSTypeAnnotation" ? decl.returnType.typeAnnotation : null;
    return [[decl.id.name, ret?.type === "TSTypeReference" && ret.typeName.type === "Identifier" ? ret.typeName.name : null]];
  }
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
  // 説明に使うのは、タグ（@ref など）を除いて文が残る最後の JSDoc。説明とタグを 2 つの JSDoc に分けて書いても、
  // タグだけの JSDoc を説明にしないため。
  const jsdocs = (comments ?? []).filter((c) => c.type === "CommentBlock" && c.value.startsWith("*"));
  for (const jsdoc of [...jsdocs].reverse()) {
    const lines = jsdoc.value
      .slice(1)
      .split("\n")
      .map((line) => line.replace(/^\s*\*?\s?/, "").replace(/\s*@[A-Za-z]+\b.*$/, "").trim());
    const start = lines.findIndex((line) => line !== "");
    if (start === -1) continue;
    const end = lines.indexOf("", start);
    return (end === -1 ? lines.slice(start) : lines.slice(start, end)).reduce((text, line) =>
      isCjk(text.at(-1)) || isCjk(line[0]) ? text + line : `${text} ${line}`,
    );
  }
  return null;
};

// 日本語の行のあいだに空白を入れない理由: JSDoc の折り返しは表示上の都合なので、日本語では空白が入ると文が不自然に途切れる。
const isCjk = (ch: string | undefined) => ch !== undefined && (ch.codePointAt(0) ?? 0) > 0x2e7f;
