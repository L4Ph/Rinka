import { isIdentifier, parseModuleSource, readStringLiteral, walkModule } from "./ast";

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

function analyzeProgram(source: string): EnvUsageAnalysis {
  const program = parseModuleSource(source);
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

export function assertDeclaredBindingsCoverEnvAccess(
  source: string,
  bindings: readonly string[],
): void {
  const { accessed, unanalyzableEnvPass } = analyzeProgram(source);

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
