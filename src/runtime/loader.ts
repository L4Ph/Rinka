import type { DynamicRouteBinding } from "../binding-policy";
import type { RinkaCtxExports, RinkaLoopbackFactory, RinkaWorkerLoader } from "../cloudflare-types";

export type DynamicRouteEntry = {
  bindings: readonly DynamicRouteBinding[];
};

export type DynamicRouteManifest = Record<string, DynamicRouteEntry>;

export type LoaderCapableEnv = Record<string, unknown> & {
  LOADER?: RinkaWorkerLoader;
};

export { getDynamicRouteManifest, registerDynamicRouteManifest } from "./manifest";

// Build-embedded dynamic Worker module code, keyed by route id. rinka bakes
// each route's bundle into the host as a string constant (see the generated
// `dynamic-modules` file) and registers it here, so the host can hand it
// straight to Worker Loader — no runtime asset fetch, no ASSETS dependency.
const dynamicModules = new Map<string, string>();

export function registerDynamicModules(modules: Record<string, string>): void {
  for (const [id, code] of Object.entries(modules)) {
    dynamicModules.set(id, code);
  }
}

export function getDynamicModule(id: string): string | undefined {
  return dynamicModules.get(id);
}

export function clearDynamicModulesForTests(): void {
  dynamicModules.clear();
}

export type ResolveLoaderEnvParams = {
  hostEnv: Record<string, unknown>;
  /** `ExecutionContext.exports` of the host Worker. */
  exports: RinkaCtxExports | undefined;
  bindings: readonly DynamicRouteBinding[];
  routeId: string;
};

/**
 * Builds the `env` handed to `LOADER.get()`. Worker Loader serializes this
 * object into the dynamic Worker, so only structured-clonable values and
 * Service Binding stubs may appear here — platform bindings are delivered as
 * stubs of host-exported `WorkerEntrypoint` proxy classes (see
 * `rinka/proxies`). The bare `ctx.exports.Proxy` loopback object does NOT
 * survive that serialization (workerd rejects `LoopbackServiceStub`), so a
 * derived stub is always created via `ctx.exports.Proxy({ props })` — with
 * the manifest's `props` when present, `{}` otherwise.
 */
export function resolveLoaderEnv(params: ResolveLoaderEnvParams): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const binding of params.bindings) {
    switch (binding.mode) {
      case "primitive":
      case "service": {
        if (!(binding.name in params.hostEnv)) {
          throw new Error(
            `rinka: dynamic route "${params.routeId}" missing host env binding "${binding.name}"`,
          );
        }
        out[binding.name] = params.hostEnv[binding.name];
        break;
      }
      case "proxy": {
        const exported = params.exports?.[binding.proxyExport];
        if (exported == null) {
          throw new Error(
            `rinka: dynamic route "${params.routeId}" binding "${binding.name}" needs ctx.exports.${binding.proxyExport} — ` +
              `export the proxy class from the Worker entry module`,
          );
        }
        if (typeof exported !== "function") {
          throw new Error(
            `rinka: dynamic route "${params.routeId}" binding "${binding.name}" — ` +
              `ctx.exports.${binding.proxyExport} is not callable`,
          );
        }
        out[binding.name] = (exported as RinkaLoopbackFactory)({ props: binding.props ?? {} });
        break;
      }
    }
  }
  return out;
}

export function hasLoaderBindings(
  env: LoaderCapableEnv,
): env is LoaderCapableEnv & { LOADER: RinkaWorkerLoader } {
  return Boolean(env.LOADER);
}

export type DelegateDynamicRouteFetchParams = {
  request: Request;
  env: LoaderCapableEnv & { LOADER: RinkaWorkerLoader };
  /** `ExecutionContext.exports` of the host Worker; required for proxy-mode bindings. */
  exports?: RinkaCtxExports;
  routeId: string;
  entry: DynamicRouteEntry;
  inlineFetch: () => Promise<Response>;
  allowInlineFallback?: boolean;
  logError?: (message: string, fields: Record<string, unknown>) => void;
};

function defaultLogError(message: string, fields: Record<string, unknown>): void {
  console.error(message, fields);
}

function moduleUnavailableResponse(): Response {
  return new Response("Dynamic route module unavailable", { status: 502 });
}

export async function delegateDynamicRouteFetch(
  params: DelegateDynamicRouteFetchParams,
): Promise<Response> {
  const logError = params.logError ?? defaultLogError;

  const code = getDynamicModule(params.routeId);
  if (code === undefined) {
    logError("rinka: dynamic route module not registered", { routeId: params.routeId });
    if (params.allowInlineFallback) return params.inlineFetch();
    return moduleUnavailableResponse();
  }

  let loaderEnv: Record<string, unknown>;
  try {
    loaderEnv = resolveLoaderEnv({
      hostEnv: params.env,
      exports: params.exports,
      bindings: params.entry.bindings,
      routeId: params.routeId,
    });
  } catch (error) {
    logError("rinka: failed to resolve loader env", {
      routeId: params.routeId,
      error,
    });
    return moduleUnavailableResponse();
  }

  const stub = params.env.LOADER.get(params.routeId, () => ({
    compatibilityDate: "2026-05-01",
    compatibilityFlags: ["nodejs_compat"],
    mainModule: "main.js",
    modules: { "main.js": code },
    env: loaderEnv,
    // globalOutbound omitted: inherit the host Worker's outbound so dynamic
    // routes can make subrequests (e.g. fetch an upstream API). Set it to a
    // Fetcher (or null) to sandbox network access instead.
  }));

  return stub.getEntrypoint().fetch(params.request);
}
