import type { DynamicRouteBinding } from "../binding-policy";
import { collectExportedNames, parseModuleSource } from "./ast";

export type ProxyExportRoute = {
  id: string;
  resolvedBindings: readonly DynamicRouteBinding[];
};

/**
 * Proxy-mode bindings resolve at runtime via `ctx.exports[proxyExport]`, and
 * `ctx.exports` only contains top-level exports of the Worker entry module —
 * a missing or misspelled class name would otherwise surface as a 502 on the
 * first request. Fail the build instead.
 */
export function assertProxyExportsExist(params: {
  entrySource: string;
  entryPath: string;
  routes: ProxyExportRoute[];
}): void {
  const exported = collectExportedNames(parseModuleSource(params.entrySource, params.entryPath));
  const missing: string[] = [];
  for (const route of params.routes) {
    for (const binding of route.resolvedBindings) {
      if (binding.mode !== "proxy") continue;
      if (exported.has(binding.proxyExport)) continue;
      missing.push(
        `route "${route.id}" binding "${binding.name}" needs export "${binding.proxyExport}"`,
      );
    }
  }
  if (missing.length === 0) return;
  throw new Error(
    `rinka: ctx.exports proxy classes missing from ${params.entryPath} top-level exports:\n- ${missing.join("\n- ")}`,
  );
}
