import type { Program } from "oxc-parser";
import { parseSync, Visitor } from "oxc-parser";

type EstreeIdentifier = { type: "Identifier"; name: string };
type EstreeObjectExpression = { type: "ObjectExpression"; properties: unknown[] };
type EstreeCallExpression = {
  type: "CallExpression";
  callee: unknown;
  arguments: unknown[];
};

export function parseModuleSource(source: string, filename = "module.ts"): Program {
  const ext = filename.split(".").pop();
  const lang = ext === "tsx" ? "tsx" : ext === "jsx" ? "jsx" : "ts";
  const result = parseSync(filename, source, { sourceType: "module", lang });
  if (result.errors.length > 0) {
    throw new SyntaxError(result.errors.map((error) => error.message).join("\n"));
  }
  return result.program;
}

export function walkModule(
  program: Program,
  visitor: ConstructorParameters<typeof Visitor>[0],
): void {
  new Visitor(visitor).visit(program);
}

export function isIdentifier(node: unknown, name?: string): node is EstreeIdentifier {
  if (
    typeof node !== "object" ||
    node === null ||
    (node as { type?: string }).type !== "Identifier"
  ) {
    return false;
  }
  return name === undefined || (node as EstreeIdentifier).name === name;
}

export function readStringLiteral(node: unknown): string | undefined {
  if (typeof node !== "object" || node === null) return undefined;
  const typed = node as { type?: string; value?: unknown };
  if (typed.type !== "Literal" && typed.type !== "StringLiteral") return undefined;
  return typeof typed.value === "string" ? typed.value : undefined;
}

export function readObjectStringProperty(
  object: EstreeObjectExpression,
  key: string,
): string | undefined {
  for (const prop of object.properties) {
    if ((prop as { type?: string }).type !== "Property") continue;
    const property = prop as { type: "Property"; key: unknown; value: unknown; kind?: string };
    const propKey = property.key;
    if (
      (isIdentifier(propKey, key) || readStringLiteral(propKey) === key) &&
      property.kind === "init"
    ) {
      return readStringLiteral(property.value);
    }
  }
  return undefined;
}

export function readObjectStringArrayProperty(
  object: EstreeObjectExpression,
  key: string,
): string[] | undefined {
  for (const prop of object.properties) {
    if ((prop as { type?: string }).type !== "Property") continue;
    const property = prop as { type: "Property"; key: unknown; value: unknown; kind?: string };
    const propKey = property.key;
    if (
      !(isIdentifier(propKey, key) || readStringLiteral(propKey) === key) ||
      property.kind !== "init"
    ) {
      continue;
    }
    if ((property.value as { type?: string }).type !== "ArrayExpression") return undefined;
    const array = property.value as { elements: unknown[] };
    const values: string[] = [];
    for (const element of array.elements) {
      if (!element) return undefined;
      const value = readStringLiteral(element);
      if (value === undefined) return undefined;
      values.push(value);
    }
    return values;
  }
  return undefined;
}

export function isDynamicCall(
  node: EstreeCallExpression,
): node is EstreeCallExpression & { arguments: [EstreeIdentifier, EstreeObjectExpression] } {
  if (!isIdentifier(node.callee, "dynamic")) return false;
  const [routeArg, optionsArg] = node.arguments;
  return isIdentifier(routeArg) && (optionsArg as { type?: string }).type === "ObjectExpression";
}

export function collectNamedImports(program: Program): Map<string, string> {
  const imports = new Map<string, string>();
  walkModule(program, {
    ImportDeclaration(node) {
      for (const spec of node.specifiers) {
        if ((spec as { type?: string }).type !== "ImportSpecifier") continue;
        const importSpec = spec as {
          imported: unknown;
          local: { name: string };
        };
        const imported = isIdentifier(importSpec.imported)
          ? importSpec.imported.name
          : readStringLiteral(importSpec.imported);
        if (!imported) continue;
        imports.set(importSpec.local.name, node.source.value);
      }
    },
  });
  return imports;
}

/** Top-level export names: `export class X`, `export const X`, `export { X }`, `export { X } from ...`. */
export function collectExportedNames(program: Program): Set<string> {
  const names = new Set<string>();
  walkModule(program, {
    ExportNamedDeclaration(node) {
      const typed = node as {
        declaration?: { id?: unknown; declarations?: unknown[] } | null;
        specifiers?: unknown[];
      };
      const declaration = typed.declaration;
      if (declaration) {
        if (isIdentifier(declaration.id)) names.add(declaration.id.name);
        for (const declarator of declaration.declarations ?? []) {
          const id = (declarator as { id?: unknown }).id;
          if (isIdentifier(id)) names.add(id.name);
        }
      }
      for (const spec of typed.specifiers ?? []) {
        const exported = (spec as { exported?: unknown }).exported;
        if (isIdentifier(exported)) {
          names.add(exported.name);
          continue;
        }
        const literal = readStringLiteral(exported);
        if (literal) names.add(literal);
      }
    },
  });
  return names;
}

export function isUpgradeHeaderWebSocketCheck(node: {
  type: "BinaryExpression";
  left: unknown;
  right: unknown;
}): boolean {
  const { left, right } = node;
  for (const side of [left, right]) {
    if ((side as { type?: string }).type !== "CallExpression") continue;
    const call = side as EstreeCallExpression;
    const callee = call.callee;
    if ((callee as { type?: string }).type !== "MemberExpression") continue;
    const member = callee as { object: unknown; property: unknown };
    if ((member.object as { type?: string }).type !== "MemberExpression") continue;
    const req = member.object as { object: unknown; property: unknown };
    if (!isIdentifier(req.object, "c")) continue;
    if (!isIdentifier(req.property, "req")) continue;
    if (!isIdentifier(member.property, "header")) continue;
    const arg = call.arguments[0];
    if (readStringLiteral(arg) !== "Upgrade") continue;
    const other = side === left ? right : left;
    if (readStringLiteral(other) === "websocket") return true;
  }
  return false;
}

export function isWebSocketPairConstruction(node: { callee: unknown }): boolean {
  return isIdentifier(node.callee, "WebSocketPair");
}
