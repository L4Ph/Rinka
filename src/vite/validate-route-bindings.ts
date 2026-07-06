import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Program } from "oxc-parser";
import {
  collectImportSources,
  isIdentifier,
  parseModuleSource,
  readStringLiteral,
  walkModule,
} from "./ast";
import { resolveModuleFile } from "./resolve-module";

type EnvUsageAnalysis = {
  accessed: Set<string>;
  unanalyzableEnvPass: boolean;
};

function isContextEnv(node: unknown, ctxName: string): boolean {
  if (typeof node !== "object" || node === null) return false;
  if ((node as { type?: string }).type !== "MemberExpression") return false;
  const member = node as { object: unknown; property: unknown; computed?: boolean };
  return (
    !member.computed && isIdentifier(member.object, ctxName) && isIdentifier(member.property, "env")
  );
}

function isEnvRoot(node: unknown, ctxName: string, envAliases: ReadonlySet<string>): boolean {
  if (isContextEnv(node, ctxName)) return true;
  return isIdentifier(node) && envAliases.has(node.name);
}

function readEnvBinding(
  node: unknown,
  ctxName: string,
  envAliases: ReadonlySet<string>,
): string | undefined {
  if (typeof node !== "object" || node === null) return undefined;
  if ((node as { type?: string }).type !== "MemberExpression") return undefined;
  const member = node as { object: unknown; property: unknown; computed?: boolean };
  if (!isEnvRoot(member.object, ctxName, envAliases)) return undefined;
  if (member.computed) {
    return readStringLiteral(member.property);
  }
  return isIdentifier(member.property) ? member.property.name : undefined;
}

function collectEnvAliases(body: unknown, ctxName: string): Set<string> {
  const aliases = new Set<string>();
  const visit = (node: unknown): void => {
    if (typeof node !== "object" || node === null) return;
    if ((node as { type?: string }).type === "VariableDeclarator") {
      const declarator = node as { id: unknown; init: unknown };
      if (isIdentifier(declarator.id) && isContextEnv(declarator.init, ctxName)) {
        aliases.add(declarator.id.name);
      }
    }
    for (const value of Object.values(node as Record<string, unknown>)) {
      if (Array.isArray(value)) {
        for (const item of value) visit(item);
      } else if (value && typeof value === "object") {
        visit(value);
      }
    }
  };
  visit(body);
  return aliases;
}

function collectBindingNamesFromPattern(pattern: unknown, names: Set<string>): void {
  if (typeof pattern !== "object" || pattern === null) return;
  if ((pattern as { type?: string }).type !== "ObjectPattern") return;
  for (const prop of (pattern as { properties: unknown[] }).properties) {
    if ((prop as { type?: string }).type !== "Property") continue;
    const property = prop as { key: unknown; value: unknown; kind?: string };
    if (property.kind !== "init") continue;
    const key = isIdentifier(property.key) ? property.key.name : readStringLiteral(property.key);
    if (!key) continue;
    if ((property.value as { type?: string }).type === "ObjectPattern") {
      collectBindingNamesFromPattern(property.value, names);
      continue;
    }
    names.add(key);
  }
}

function analyzeNode(
  node: unknown,
  ctxName: string,
  envAliases: ReadonlySet<string>,
  analysis: EnvUsageAnalysis,
): void {
  if (typeof node !== "object" || node === null) return;
  const typed = node as { type?: string };

  if (typed.type === "MemberExpression") {
    const binding = readEnvBinding(node, ctxName, envAliases);
    if (binding) analysis.accessed.add(binding);
  }

  if (typed.type === "VariableDeclarator") {
    const declarator = node as { id: unknown; init: unknown };
    if (isContextEnv(declarator.init, ctxName)) {
      collectBindingNamesFromPattern(declarator.id, analysis.accessed);
    }
  }

  if (typed.type === "CallExpression") {
    const call = node as { arguments: unknown[] };
    for (const arg of call.arguments) {
      if (isContextEnv(arg, ctxName)) {
        analysis.unanalyzableEnvPass = true;
      }
    }
  }

  for (const value of Object.values(node as Record<string, unknown>)) {
    if (Array.isArray(value)) {
      for (const item of value) analyzeNode(item, ctxName, envAliases, analysis);
    } else if (value && typeof value === "object") {
      analyzeNode(value, ctxName, envAliases, analysis);
    }
  }
}

function analyzeFunctionBody(body: unknown, ctxName: string): EnvUsageAnalysis {
  const analysis: EnvUsageAnalysis = {
    accessed: new Set<string>(),
    unanalyzableEnvPass: false,
  };
  const envAliases = collectEnvAliases(body, ctxName);
  analyzeNode(body, ctxName, envAliases, analysis);
  return analysis;
}

function analyzeProgramNode(program: Program): EnvUsageAnalysis {
  const combined: EnvUsageAnalysis = {
    accessed: new Set<string>(),
    unanalyzableEnvPass: false,
  };

  const visitFunctionLike = (node: { params?: unknown[]; body?: unknown }) => {
    const firstParam = node.params?.[0];
    if (!isIdentifier(firstParam)) return;
    const ctxName = firstParam.name;
    const result = analyzeFunctionBody(node.body, ctxName);
    for (const name of result.accessed) combined.accessed.add(name);
    combined.unanalyzableEnvPass ||= result.unanalyzableEnvPass;
  };

  walkModule(program, {
    FunctionDeclaration(node) {
      visitFunctionLike(node);
    },
    FunctionExpression(node) {
      visitFunctionLike(node);
    },
    ArrowFunctionExpression(node) {
      visitFunctionLike(node);
    },
  });

  return combined;
}

function analyzeProgram(source: string, filename = "module.ts"): EnvUsageAnalysis {
  return analyzeProgramNode(parseModuleSource(source, filename));
}

function isLocalSpecifier(spec: string, pathAliases: Record<string, string>): boolean {
  if (spec.startsWith(".")) return true;
  for (const alias of Object.keys(pathAliases)) {
    const prefix = alias.endsWith("*") ? alias.slice(0, -1) : alias;
    if (prefix.length > 0 && spec.startsWith(prefix)) return true;
  }
  return false;
}

/**
 * Env access of a route module *and* the local modules it imports (middleware,
 * helpers). A route delivered to an isolate carries its imported middleware, so
 * a binding that only a `.use()`'d middleware touches still has to be declared.
 * Only relative / path-aliased imports are followed — third-party packages are
 * left alone. Cycles are guarded by a visited set.
 */
export function collectEnvAccessDeep(
  entryPath: string,
  pathAliases: Record<string, string> = {},
): EnvUsageAnalysis {
  const combined: EnvUsageAnalysis = {
    accessed: new Set<string>(),
    unanalyzableEnvPass: false,
  };
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

    const program = parseModuleSource(source, filePath);
    const local = analyzeProgramNode(program);
    for (const name of local.accessed) combined.accessed.add(name);
    combined.unanalyzableEnvPass ||= local.unanalyzableEnvPass;

    for (const spec of collectImportSources(program)) {
      if (!isLocalSpecifier(spec, pathAliases)) continue;
      let resolved: string;
      try {
        resolved = resolveModuleFile(spec, dirname(filePath), pathAliases);
      } catch {
        continue;
      }
      visit(resolved);
    }
  };

  visit(entryPath);
  return combined;
}

function assertCoverage(analysis: EnvUsageAnalysis, bindings: readonly string[]): void {
  const { accessed, unanalyzableEnvPass } = analysis;

  if (unanalyzableEnvPass && bindings.length === 0) {
    throw new Error(
      "Dynamic route passes context env to a helper but declared bindings: [] (declare all bindings used by helpers)",
    );
  }

  if (accessed.size === 0) return;

  if (bindings.length === 0) {
    throw new Error(
      `Dynamic route uses env bindings (${[...accessed].sort().join(", ")}) but declared bindings: []`,
    );
  }

  const declared = new Set(bindings);
  const missing = [...accessed].filter((name) => !declared.has(name)).sort();
  if (missing.length > 0) {
    throw new Error(
      `Dynamic route uses env bindings not declared in dynamic(..., { bindings }): ${missing.join(", ")}`,
    );
  }
}

/** Asserts declared bindings cover the env access of a single module source. */
export function assertDeclaredBindingsCoverEnvAccess(
  source: string,
  bindings: readonly string[],
  filename = "module.ts",
): void {
  assertCoverage(analyzeProgram(source, filename), bindings);
}

/**
 * Asserts declared bindings cover the env access of a route module and its
 * local imports (middleware and helpers it pulls in), which travel into the
 * isolate with the route.
 */
export function assertDeclaredBindingsCoverEnvAccessDeep(
  entryPath: string,
  bindings: readonly string[],
  pathAliases: Record<string, string> = {},
): void {
  assertCoverage(collectEnvAccessDeep(entryPath, pathAliases), bindings);
}
