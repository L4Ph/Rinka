import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  collectNamedImports,
  isIdentifier,
  parseModuleSource,
  readObjectBooleanProperty,
  readObjectIdentifierProperty,
  readObjectStringArrayProperty,
  readObjectStringProperty,
  walkModule,
} from "./ast";
import { defaultPathAliases, resolveModuleFile } from "./resolve-module";

export type ScannedRoute = {
  mount: string;
  /** Stable isolate id (dynamic routes) or a mount-derived slug (inline). */
  id: string;
  /** Local name of the imported route app. */
  exportName: string;
  /** Absolute path of the route module. */
  modulePath: string;
  dynamic: boolean;
  bindings: string[];
  registeredIn: string;
};

type ObjectNode = { type: "ObjectExpression"; properties: unknown[] };

function slugFromMount(mount: string): string {
  const slug = mount.replace(/^\/+|\/+$/g, "").replace(/[^A-Za-z0-9]+/g, "-");
  return slug === "" ? "index" : slug;
}

export function scanRouteRegistrations(
  source: string,
  registeredIn: string,
  registeredInDir: string,
  pathAliases: Record<string, string> = {},
): ScannedRoute[] {
  const program = parseModuleSource(source, registeredIn);
  const imports = collectNamedImports(program);
  const routes: ScannedRoute[] = [];
  let sawDefineRoutes = false;

  walkModule(program, {
    CallExpression(node) {
      if (!isIdentifier(node.callee, "defineRoutes")) return;
      sawDefineRoutes = true;

      const arg = node.arguments[0];
      if (!arg || (arg as { type?: string }).type !== "ArrayExpression") {
        throw new Error(`defineRoutes in ${registeredIn} must be called with an array literal`);
      }

      for (const el of (arg as { elements: unknown[] }).elements) {
        if (!el || (el as { type?: string }).type !== "ObjectExpression") {
          throw new Error(`defineRoutes entries in ${registeredIn} must be object literals`);
        }
        const obj = el as ObjectNode;

        const mount = readObjectStringProperty(obj, "mount");
        if (!mount) {
          throw new Error(`A defineRoutes entry in ${registeredIn} is missing "mount"`);
        }

        const exportName = readObjectIdentifierProperty(obj, "route");
        if (!exportName) {
          throw new Error(
            `defineRoutes entry "${mount}" in ${registeredIn} needs "route" to be an imported route identifier`,
          );
        }

        const dynamic = readObjectBooleanProperty(obj, "dynamic") ?? false;
        const bindings = readObjectStringArrayProperty(obj, "bindings") ?? [];
        const explicitId = readObjectStringProperty(obj, "id");
        if (dynamic && !explicitId) {
          throw new Error(`Dynamic route "${mount}" in ${registeredIn} is missing "id"`);
        }
        const id = explicitId ?? slugFromMount(mount);

        const importPath = imports.get(exportName);
        if (!importPath) {
          throw new Error(`Could not resolve import for route "${exportName}" in ${registeredIn}`);
        }

        routes.push({
          mount,
          id,
          exportName,
          modulePath: resolveModuleFile(importPath, registeredInDir, pathAliases),
          dynamic,
          bindings,
          registeredIn,
        });
      }
    },
  });

  if (!sawDefineRoutes) {
    throw new Error(`No defineRoutes([...]) call found in ${registeredIn}`);
  }

  const dynamicIds = routes.filter((r) => r.dynamic).map((r) => r.id);
  const dup = dynamicIds.find((id, i) => dynamicIds.indexOf(id) !== i);
  if (dup) {
    throw new Error(`Duplicate dynamic route id "${dup}" in ${registeredIn}`);
  }

  return routes;
}

export function scanRouteRegistrationsInFile(
  filePath: string,
  root?: string,
  pathAliases?: Record<string, string>,
): ScannedRoute[] {
  const source = readFileSync(filePath, "utf8");
  const aliases = pathAliases ?? (root ? defaultPathAliases(root) : {});
  return scanRouteRegistrations(source, filePath, dirname(filePath), aliases);
}
