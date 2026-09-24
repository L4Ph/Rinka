import type { ScannedLoopback } from "./scan-dynamic-routes";
import { collectExportedNames, parseModuleSource } from "./ast";

export type LoopbackExportRoute = {
  id: string;
  loopbacks: readonly ScannedLoopback[];
};

/**
 * Loopback bindings resolve at runtime via `ctx.exports[export]`, and
 * `ctx.exports` only contains top-level exports of the Worker entry module — a
 * missing or misspelled class name would otherwise surface as a 502 on the first
 * request. Fail the build instead.
 */
export function assertLoopbackExportsExist(params: {
  entrySource: string;
  entryPath: string;
  routes: readonly LoopbackExportRoute[];
}): void {
  const exported = collectExportedNames(parseModuleSource(params.entrySource, params.entryPath));
  const missing: string[] = [];
  for (const route of params.routes) {
    for (const loopback of route.loopbacks) {
      if (exported.has(loopback.export)) continue;
      missing.push(
        `route "${route.id}" binding "${loopback.name}" needs export "${loopback.export}"`,
      );
    }
  }
  if (missing.length === 0) return;
  throw new Error(
    `rinka: ctx.exports loopback classes missing from ${params.entryPath} top-level exports:\n- ${missing.join("\n- ")}`,
  );
}
