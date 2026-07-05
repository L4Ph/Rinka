import { Hono, type Context, type Hono as HonoType, type Next } from "hono";
import type {
  RinkaCtxExports,
  RinkaExecutionContext,
  RinkaFetcher,
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
      return delegateDynamicRouteFetch({
        request,
        env: env as LoaderCapableEnv & { LOADER: RinkaWorkerLoader; ASSETS: RinkaFetcher },
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
