import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  collectNamedImports,
  isDynamicCall,
  parseModuleSource,
  readObjectStringArrayProperty,
  readObjectStringProperty,
  walkModule,
} from "./ast";
import { defaultPathAliases, resolveModuleFile } from "./resolve-module";

export type ScannedDynamicRoute = {
  id: string;
  bindings: string[];
  exportName: string;
  registeredIn: string;
  modulePath: string;
};

function countTextualDynamicCalls(source: string): number {
  return (source.match(/\bdynamic\s*\(/g) ?? []).length;
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

      const importPath = imports.get(routeArg.name);
      if (!importPath) {
        throw new Error(
          `Could not resolve import for dynamic route ${routeArg.name} in ${registeredIn}`,
        );
      }

      routes.push({
        id,
        bindings,
        exportName: routeArg.name,
        registeredIn,
        modulePath: resolveModuleFile(importPath, registeredInDir, pathAliases),
      });
    },
  });

  const textualCount = countTextualDynamicCalls(source);
  if (textualCount !== routes.length) {
    throw new Error(
      `Found ${textualCount} dynamic( calls but parsed ${routes.length} in ${registeredIn}. Check options shape (id/bindings required).`,
    );
  }

  return routes;
}

export function scanDynamicRoutesInFile(
  filePath: string,
  root?: string,
  pathAliases?: Record<string, string>,
): ScannedDynamicRoute[] {
  const source = readFileSync(filePath, "utf8");
  const aliases = pathAliases ?? (root ? defaultPathAliases(root) : {});
  return scanDynamicRoutes(source, filePath, dirname(filePath), aliases);
}
