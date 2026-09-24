import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  collectImportSources,
  collectNamedImports,
  isDynamicCall,
  parseModuleSource,
  readObjectStringArrayProperty,
  readObjectStringProperty,
  walkModule,
} from "./ast";
import { defaultPathAliases, isLocalSpecifier, resolveModuleFile } from "./resolve-module";

export type ScannedLoopback = {
  /** Name the dynamic Worker reads, e.g. `STORAGE`. */
  name: string;
  /** Host entry module export of the `WorkerEntrypoint` class. */
  export: string;
};

export type ScannedDynamicRoute = {
  id: string;
  /** Env names copied from the host env. */
  bindings: string[];
  /** `ctx.exports` loopbacks declared for this route. */
  loopbacks: ScannedLoopback[];
  exportName: string;
  registeredIn: string;
  modulePath: string;
};

type ObjectNode = { type: "ObjectExpression"; properties: unknown[] };

/**
 * Removes comments so a `dynamic(` mentioned in a comment or doc string is not
 * mistaken for a real call by the textual guard. String contents are preserved.
 */
function stripComments(source: string): string {
  let out = "";
  let i = 0;
  let state: "code" | "line" | "block" | "single" | "double" | "template" = "code";
  const length = source.length;
  while (i < length) {
    const ch = source[i]!;
    const next = source[i + 1];
    if (state === "code") {
      if (ch === "/" && next === "/") {
        state = "line";
        i += 2;
        continue;
      }
      if (ch === "/" && next === "*") {
        state = "block";
        i += 2;
        continue;
      }
      if (ch === "'" || ch === '"' || ch === "`") {
        state = ch === "'" ? "single" : ch === '"' ? "double" : "template";
      }
      out += ch;
      i += 1;
      continue;
    }
    if (state === "line") {
      if (ch === "\n") {
        state = "code";
        out += ch;
      }
      i += 1;
      continue;
    }
    if (state === "block") {
      if (ch === "*" && next === "/") {
        state = "code";
        i += 2;
      } else i += 1;
      continue;
    }
    out += ch;
    if (ch === "\\") {
      out += next ?? "";
      i += 2;
      continue;
    }
    if (
      (state === "single" && ch === "'") ||
      (state === "double" && ch === '"') ||
      (state === "template" && ch === "`")
    ) {
      state = "code";
    }
    i += 1;
  }
  return out;
}

function countTextualDynamicCalls(source: string): number {
  return (stripComments(source).match(/\bdynamic\s*\(/g) ?? []).length;
}

/** Reads `loopbacks: { NAME: { export: "X", props: {...} } }` (props are ignored here). */
function readObjectLoopbacks(object: unknown): ScannedLoopback[] | undefined {
  if (typeof object !== "object" || object === null) return undefined;
  const typed = object as ObjectNode;
  if (typed.type !== "ObjectExpression") return undefined;

  for (const prop of typed.properties) {
    if ((prop as { type?: string }).type !== "Property") continue;
    const property = prop as { key: unknown; value: unknown; kind?: string };
    if (property.kind !== "init") continue;
    const key = property.key;
    const isLoopbacks =
      (typeof key === "object" &&
        key !== null &&
        (key as { name?: string }).name === "loopbacks") ||
      (key as { value?: unknown }).value === "loopbacks";
    if (!isLoopbacks) continue;

    const value = property.value as ObjectNode;
    if (value.type !== "ObjectExpression") {
      throw new Error("dynamic() loopbacks must be an object literal");
    }
    const loopbacks: ScannedLoopback[] = [];
    for (const entry of value.properties) {
      if ((entry as { type?: string }).type !== "Property") continue;
      const entryProperty = entry as { key: unknown; value: unknown; kind?: string };
      if (entryProperty.kind !== "init") continue;
      const name = readStringLiteralOrIdentifier(entryProperty.key);
      if (!name) throw new Error("dynamic() loopbacks keys must be identifiers or strings");
      const declaration = entryProperty.value as ObjectNode;
      if (declaration.type !== "ObjectExpression") {
        throw new Error(`dynamic() loopbacks.${name} must be an object literal`);
      }
      const exportName = readObjectStringProperty(declaration, "export");
      if (!exportName) {
        throw new Error(`dynamic() loopbacks.${name} needs a string "export"`);
      }
      loopbacks.push({ name, export: exportName });
    }
    return loopbacks;
  }
  return undefined;
}

function readStringLiteralOrIdentifier(node: unknown): string | undefined {
  if (typeof node !== "object" || node === null) return undefined;
  const typed = node as { type?: string; name?: string; value?: unknown };
  if (typed.type === "Identifier") return typed.name;
  if (typed.type === "Literal" || typed.type === "StringLiteral") {
    return typeof typed.value === "string" ? typed.value : undefined;
  }
  return undefined;
}

export function scanDynamicRoutes(
  source: string,
  registeredIn: string,
  registeredInDir: string,
  pathAliases: Record<string, string> = {},
): ScannedDynamicRoute[] {
  const program = parseModuleSource(source, registeredIn);
  const imports = collectNamedImports(program);
  const routes: ScannedDynamicRoute[] = [];

  walkModule(program, {
    CallExpression(node) {
      if (!isDynamicCall(node)) return;
      const routeArg = node.arguments[0];
      const optionsArg = node.arguments[1];

      const id = readObjectStringProperty(optionsArg, "id");
      if (!id) {
        throw new Error(`dynamic() call for ${routeArg.name} in ${registeredIn} is missing id`);
      }

      const bindings = readObjectStringArrayProperty(optionsArg, "bindings");
      if (bindings === undefined) {
        throw new Error(
          `dynamic() call for ${routeArg.name} in ${registeredIn} is missing bindings (use bindings: [] when none are needed)`,
        );
      }

      const loopbacks = readObjectLoopbacks(optionsArg) ?? [];

      const importPath = imports.get(routeArg.name);
      if (!importPath) {
        throw new Error(
          `Could not resolve import for dynamic route ${routeArg.name} in ${registeredIn}`,
        );
      }

      routes.push({
        id,
        bindings,
        loopbacks,
        exportName: routeArg.name,
        registeredIn,
        modulePath: resolveModuleFile(importPath, registeredInDir, pathAliases),
      });
    },
  });

  const textualCount = countTextualDynamicCalls(source);
  if (imports.has("dynamic") && textualCount !== routes.length) {
    throw new Error(
      `Found ${textualCount} dynamic( calls but parsed ${routes.length} in ${registeredIn}. Check options shape (id/bindings required).`,
    );
  }

  return routes;
}

/**
 * Scans the app entry and the local modules it imports for `dynamic()` calls.
 * Only `dynamic()` call sites matter to rinka — inline routes need no
 * declaration. Cycles are guarded by a visited set; third-party imports are
 * skipped.
 */
export function scanDynamicRoutesFromEntry(
  entryPath: string,
  pathAliases: Record<string, string>,
): ScannedDynamicRoute[] {
  const routes: ScannedDynamicRoute[] = [];
  const visited = new Set<string>();

  const visit = (filePath: string): void => {
    if (visited.has(filePath)) return;
    visited.add(filePath);

    let source: string;
    try {
      source = readFileSync(filePath, "utf8");
    } catch {
      return;
    }

    routes.push(...scanDynamicRoutes(source, filePath, dirname(filePath), pathAliases));

    const program = parseModuleSource(source, filePath);
    for (const spec of collectImportSources(program)) {
      if (!isLocalSpecifier(spec, pathAliases)) continue;
      try {
        visit(resolveModuleFile(spec, dirname(filePath), pathAliases));
      } catch {
        // Unresolvable import (e.g. a type-only path) is irrelevant to bundling.
      }
    }
  };

  visit(entryPath);
  return routes;
}

export function scanDynamicRoutesInFile(
  filePath: string,
  root?: string,
  pathAliases?: Record<string, string>,
): ScannedDynamicRoute[] {
  const aliases = pathAliases ?? (root ? defaultPathAliases(root) : {});
  return scanDynamicRoutesFromEntry(filePath, aliases);
}
