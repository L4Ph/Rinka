import type { Hono } from "hono";

/**
 * One route registration in a rinka `defineRoutes([...])` manifest.
 *
 * A route is `inline` (runs in the host) by default; set `dynamic: true` to run
 * it in a dynamically-loaded Worker isolate. rinka scans these entries at build
 * time to generate the type-only `AppType` aggregator and the dispatch wiring.
 */
export type RouteRegistration = {
  /** Mount path, e.g. `"/"` or `"/shops"`. */
  mount: string;
  /** The route app (a Hono instance). */
  route: Hono<any, any, any>;
  /** Stable id for the dynamic Worker; required when `dynamic` is true. */
  id?: string;
  /** Run this route in a dynamically-loaded Worker isolate. */
  dynamic?: boolean;
  /** Bindings the dynamic route declares (validated at build time). */
  bindings?: readonly string[];
};

/**
 * Declares the app's routes in a single place — the one source of truth rinka
 * scans to generate `AppType` (type-only) and `registerDispatch`. The returned
 * value is the input verbatim; it is not consumed at runtime (the generated
 * dispatch is), so this is effectively a build-time DSL.
 */
export function defineRoutes<const T extends readonly RouteRegistration[]>(routes: T): T {
  return routes;
}
