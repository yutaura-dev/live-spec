import { parse } from "@babel/parser";
import type * as t from "@babel/types";

export type MutationOperator = "remove" | "drop-disjunct" | "drop-conjunct" | "flip-equality" | "boundary" | "swap-value";

export interface SourceMutant {
  readonly operator: MutationOperator;
  readonly action: string;
  readonly reason: string;
  readonly line: number;
  /** 書き換えた後の ensure の条件 */
  readonly condition: string;
  readonly source: string;
}

type FieldValues = Readonly<Record<string, ReadonlyArray<string | boolean>>>;

const FLIP: Readonly<Record<string, string>> = { "===": "!==", "!==": "===", "==": "!=", "!=": "==" };
const SHIFT: Readonly<Record<string, string>> = { "<": "<=", "<=": "<", ">": ">=", ">=": ">" };

const childrenOf = (node: t.Node): Array<t.Node> =>
  Object.entries(node).flatMap(([key, value]) => {
    if (key === "loc" || key.endsWith("Comments")) return [];
    const items: Array<unknown> = Array.isArray(value) ? value : [value];
    return items.filter((v): v is t.Node => typeof v === "object" && v !== null && "type" in v);
  });

const reasonOf = (arg: t.Node | undefined) =>
  arg?.type === "StringLiteral"
    ? arg.value
    : arg?.type === "TemplateLiteral" && arg.expressions.length === 0
      ? arg.quasis.map((q) => q.value.cooked ?? "").join("")
      : null;

export const sourceMutants = (source: string, fields: FieldValues): Array<SourceMutant> => {
  const file = parse(source, { sourceType: "module", plugins: ["typescript"] });
  const mutants: Array<SourceMutant> = [];

  const visitEnsures = (node: t.Node, action: string) => {
    if (node.type === "CallExpression" && node.callee.type === "Identifier" && node.callee.name === "ensure") {
      const cond = node.arguments[0];
      const reason = reasonOf(node.arguments[1]);
      if (cond !== undefined && reason !== null) mutantsOf(cond, action, reason, node.loc!.start.line);
    }
    for (const child of childrenOf(node)) visitEnsures(child, action);
  };

  const mutantsOf = (cond: t.Node, action: string, reason: string, line: number) => {
    const at = (start: number, end: number, text: string) => source.slice(cond.start!, start) + text + source.slice(end, cond.end!);
    const push = (operator: MutationOperator, condition: string) =>
      mutants.push({ operator, action, reason, line, condition, source: source.slice(0, cond.start!) + condition + source.slice(cond.end!) });

    push("remove", "true");
    const walk = (n: t.Node) => {
      if (n.type === "LogicalExpression" && (n.operator === "||" || n.operator === "&&")) {
        const op = n.operator === "||" ? "drop-disjunct" : "drop-conjunct";
        push(op, at(n.start!, n.end!, source.slice(n.right.start!, n.right.end!)));
        push(op, at(n.start!, n.end!, source.slice(n.left.start!, n.left.end!)));
      }
      if (n.type === "BinaryExpression") {
        const opStart = source.indexOf(n.operator, n.left.end!);
        const flipped = FLIP[n.operator];
        if (flipped !== undefined) push("flip-equality", at(opStart, opStart + n.operator.length, flipped));
        const shifted = SHIFT[n.operator];
        if (shifted !== undefined) push("boundary", at(opStart, opStart + n.operator.length, shifted));
        if (n.operator === "===" || n.operator === "!==") {
          const [member, literal] = n.right.type === "StringLiteral" ? [n.left, n.right] : n.left.type === "StringLiteral" ? [n.right, n.left] : [null, null];
          const field = member?.type === "MemberExpression" && member.property.type === "Identifier" ? member.property.name : null;
          if (literal !== null && field !== null) {
            for (const value of fields[field] ?? []) {
              if (typeof value !== "string" || value === literal.value) continue;
              push("swap-value", at(literal.start!, literal.end!, JSON.stringify(value)));
            }
          }
        }
      }
      for (const child of childrenOf(n)) walk(child);
    };
    walk(cond);
  };

  for (const stmt of file.program.body) {
    const decl = stmt.type === "ExportNamedDeclaration" ? stmt.declaration : null;
    if (decl?.type === "FunctionDeclaration" && decl.id != null) visitEnsures(decl, decl.id.name);
  }
  return mutants;
};
