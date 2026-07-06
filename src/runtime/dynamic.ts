import { Hono, type Context, type Hono as HonoType, type Next } from "hono";
import type {
  RinkaCtxExports,
  RinkaExecutionContext,
  RinkaWorkerLoader,
} from "../cloudflare-types";
import {
  delegateDynamicRouteFetch,
  getDynamicRouteManifest,
  hasLoaderBindings,
  type LoaderCapableEnv,
} from "./loader";

/** Bindings type of a Hono route (`Hono<{ Bindings: B }>` → `B`). */
type HonoBindingsOf<T> =
  T extends HonoType<infer E, any, any>
    ? E extends { Bindings: infer B }
      ? B
      : Record<string, unknown>
    : Record<string, unknown>;

/**
 * `bindings` is constrained to the route's declared `Bindings` keys, so a
 * typo'd binding name fails the host's typecheck. Routes without a `Bindings`
 * type fall back to arbitrary strings (still validated at build time).
 */
export type DynamicRouteOptions<TBindings = Record<string, unknown>> = {
  id: string;
  bindings: readonly Extract<keyof TBindings, string>[];
};

function rewriteRequestForMount(request: Request, mountPrefix: string): Request {
  const originalUrl = new URL(request.url);
  const newUrl = new URL(originalUrl);
  newUrl.pathname = originalUrl.pathname.slice(mountPrefix.length) || "/";
  return new Request(newUrl, request);
}

// Hono's `executionCtx` getter throws when no ExecutionContext was provided
// (e.g. `app.request()` in tests). `exports` itself is also absent unless the
// host runs with the `enable_ctx_exports` compatibility flag — proxy-mode
// bindings surface a descriptive error from resolveLoaderEnv in that case.
function getCtxExports(c: Context): RinkaCtxExports | undefined {
  try {
    return (c.executionCtx as RinkaExecutionContext).exports;
  } catch {
    return undefined;
  }
}

/**
 * Whether the wrapped route has a real handler for `method` + `path`. The
 * wrapper mounts delegation on `"*"`, which matches every request under the
 * mount prefix — including paths the route itself does not serve. Delegating
 * those would swallow sibling routes mounted at the same prefix (host routes or
 * other dynamic routes) and misroute them into this route's isolate, so we only
 * delegate when the route actually matches and otherwise fall through.
 *
 * A route may apply its own middleware (e.g. a renderer via `use("*")`). Such
 * middleware matches every path but does not itself handle the request, so it
 * is ignored — otherwise a route with any global middleware would look like it
 * handles every path and start swallowing siblings again.
 */
function routeHandlesRequest(
  route: HonoType<any, any, any>,
  method: string,
  path: string,
): boolean {
  const [matched] = route.router.match(method, path);
  return matched.some((entry) => {
    const routerRoute = entry[0][1] as { method: string; path: string };
    return !(routerRoute.method === "ALL" && routerRoute.path.endsWith("*"));
  });
}

export function dynamic<T extends HonoType<any, any, any>>(
  route: T,
  options: DynamicRouteOptions<HonoBindingsOf<T>>,
): T {
  type E = T extends HonoType<infer Env, any, any> ? Env : never;
  const wrapper = new Hono<E>();
  const maybeDelegate = async (c: Context<E>, next: Next) => {
    const entry = getDynamicRouteManifest()[options.id];
    const env = c.env as LoaderCapableEnv;
    if (entry && hasLoaderBindings(env)) {
      const mountPrefix = c.req.routePath.replace(/\/\*$/, "");
      const request = rewriteRequestForMount(c.req.raw, mountPrefix);
      if (!routeHandlesRequest(route, c.req.method, new URL(request.url).pathname)) {
        return next();
      }
      return delegateDynamicRouteFetch({
        request,
        env: env as LoaderCapableEnv & { LOADER: RinkaWorkerLoader },
        exports: getCtxExports(c),
        routeId: options.id,
        entry,
        inlineFetch: async () => {
          await next();
          if (!c.res) {
            throw new Error(`dynamic route ${options.id} inline fallback produced no response`);
          }
          return c.res;
        },
      });
    }
    return next();
  };
  wrapper.use("*", maybeDelegate);
  wrapper.route("/", route);
  return wrapper as T;
}
