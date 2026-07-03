import type { DynamicRouteBinding } from "../binding-policy";
import type {
  HibanaCtxExports,
  HibanaFetcher,
  HibanaLoopbackFactory,
  HibanaWorkerLoader,
} from "../cloudflare-types";

export type DynamicRouteEntry = {
  assetPath: string;
  bindings: readonly DynamicRouteBinding[];
};

export type DynamicRouteManifest = Record<string, DynamicRouteEntry>;

export type LoaderCapableEnv = Record<string, unknown> & {
  LOADER?: HibanaWorkerLoader;
  ASSETS?: HibanaFetcher;
};

export { getDynamicRouteManifest, registerDynamicRouteManifest } from "./manifest";

const dynamicRouteModuleCache = new Map<string, string>();

export function clearDynamicRouteModuleCacheForTests(): void {
  dynamicRouteModuleCache.clear();
}

export type ResolveLoaderEnvParams = {
  hostEnv: Record<string, unknown>;
  /** `ExecutionContext.exports` of the host Worker. */
  exports: HibanaCtxExports | undefined;
  bindings: readonly DynamicRouteBinding[];
  routeId: string;
};

/**
 * Builds the `env` handed to `LOADER.get()`. Worker Loader serializes this
 * object into the dynamic Worker, so only structured-clonable values and
 * Service Binding stubs may appear here — platform bindings are delivered as
 * stubs of host-exported `WorkerEntrypoint` proxy classes (see
 * `hibana/proxies`). The bare `ctx.exports.Proxy` loopback object does NOT
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
            `hibana: dynamic route "${params.routeId}" missing host env binding "${binding.name}"`,
          );
        }
        out[binding.name] = params.hostEnv[binding.name];
        break;
      }
      case "proxy": {
        const exported = params.exports?.[binding.proxyExport];
        if (exported == null) {
          throw new Error(
            `hibana: dynamic route "${params.routeId}" binding "${binding.name}" needs ctx.exports.${binding.proxyExport} — ` +
              `export the proxy class from the Worker entry module`,
          );
        }
        if (typeof exported !== "function") {
          throw new Error(
            `hibana: dynamic route "${params.routeId}" binding "${binding.name}" — ` +
              `ctx.exports.${binding.proxyExport} is not callable`,
          );
        }
        out[binding.name] = (exported as HibanaLoopbackFactory)({ props: binding.props ?? {} });
        break;
      }
    }
  }
  return out;
}

export function hasLoaderBindings(env: LoaderCapableEnv): env is LoaderCapableEnv & {
  LOADER: HibanaWorkerLoader;
  ASSETS: HibanaFetcher;
} {
  return Boolean(env.LOADER && env.ASSETS);
}

export type DelegateDynamicRouteFetchParams = {
  request: Request;
  env: LoaderCapableEnv & { LOADER: HibanaWorkerLoader; ASSETS: HibanaFetcher };
  /** `ExecutionContext.exports` of the host Worker; required for proxy-mode bindings. */
  exports?: HibanaCtxExports;
  routeId: string;
  entry: DynamicRouteEntry;
  inlineFetch: () => Promise<Response>;
  allowInlineFallback?: boolean;
  logError?: (message: string, fields: Record<string, unknown>) => void;
};

function defaultLogError(message: string, fields: Record<string, unknown>): void {
  console.error(message, fields);
}

function loaderAssetUnavailableResponse(): Response {
  return new Response("Dynamic route asset unavailable", { status: 502 });
}

async function loadModuleCode(params: DelegateDynamicRouteFetchParams): Promise<string | Response> {
  const cached = dynamicRouteModuleCache.get(params.routeId);
  if (cached) return cached;

  // Base the asset URL on the incoming request: the ASSETS binding ignores the
  // host in production, but in dev it resolves through the Vite dev server,
  // whose `server.allowedHosts` check 403s synthetic hosts.
  const assetUrl = new URL(params.entry.assetPath, params.request.url);
  const logError = params.logError ?? defaultLogError;

  let assetResponse: Response;
  try {
    assetResponse = await params.env.ASSETS.fetch(assetUrl);
  } catch (error) {
    logError("hibana: ASSETS.fetch failed", {
      routeId: params.routeId,
      assetPath: params.entry.assetPath,
      error,
    });
    if (params.allowInlineFallback) {
      return params.inlineFetch();
    }
    return loaderAssetUnavailableResponse();
  }

  if (!assetResponse.ok) {
    logError("hibana: dynamic route asset missing", {
      routeId: params.routeId,
      assetPath: params.entry.assetPath,
      status: assetResponse.status,
    });
    if (params.allowInlineFallback) {
      return params.inlineFetch();
    }
    return loaderAssetUnavailableResponse();
  }

  const moduleCode = await assetResponse.text();
  dynamicRouteModuleCache.set(params.routeId, moduleCode);
  return moduleCode;
}

export async function delegateDynamicRouteFetch(
  params: DelegateDynamicRouteFetchParams,
): Promise<Response> {
  const loaded = await loadModuleCode(params);
  if (loaded instanceof Response) return loaded;

  const logError = params.logError ?? defaultLogError;
  let loaderEnv: Record<string, unknown>;
  try {
    loaderEnv = resolveLoaderEnv({
      hostEnv: params.env,
      exports: params.exports,
      bindings: params.entry.bindings,
      routeId: params.routeId,
    });
  } catch (error) {
    logError("hibana: failed to resolve loader env", {
      routeId: params.routeId,
      error,
    });
    return loaderAssetUnavailableResponse();
  }

  const stub = params.env.LOADER.get(params.routeId, () => ({
    compatibilityDate: "2026-05-01",
    compatibilityFlags: ["nodejs_compat"],
    mainModule: "main.js",
    modules: { "main.js": loaded },
    env: loaderEnv,
    globalOutbound: null,
  }));

  return stub.getEntrypoint().fetch(params.request);
}
