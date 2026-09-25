import type { LoopbackDeclaration } from "../binding";
import type {
  RinkaCtxExports,
  RinkaFetcher,
  RinkaLoopbackFactory,
  RinkaWorkerLoader,
} from "../cloudflare-types";

export type LoaderCapableEnv = Record<string, unknown> & {
  LOADER?: RinkaWorkerLoader;
  ASSETS?: RinkaFetcher;
};

/**
 * Env key rinka injects into a dynamic Worker's isolate so the running code (and
 * tooling) can tell it is executing dynamically, and which route it is. Inline
 * routes run in the host and never receive it.
 */
export const RINKA_ROUTE_ID_ENV_KEY = "__rinkaRouteId";

/** The dynamic route id when running inside a rinka Worker isolate, else undefined. */
export function getDynamicRouteId(env: Record<string, unknown> | undefined): string | undefined {
  const value = env?.[RINKA_ROUTE_ID_ENV_KEY];
  return typeof value === "string" ? value : undefined;
}

export function hasLoaderBindings(
  env: LoaderCapableEnv,
): env is LoaderCapableEnv & { LOADER: RinkaWorkerLoader } {
  return Boolean(env.LOADER);
}

/**
 * Build/runtime config injected by the Vite plugin via `define`. `buildId` is
 * baked into the Worker Loader cache key (`${id}@${buildId}`) so changed route
 * code loads a fresh isolate; `assetsBasePath` is where the plugin emitted the
 * bundled route modules. Falls back to defaults when the plugin's `define` did
 * not run (e.g. a route imported outside a rinka build).
 */
declare const __RINKA_RUNTIME_CONFIG__: { buildId: string; assetsBasePath: string } | undefined;

const DEFAULT_RUNTIME_CONFIG = { buildId: "dev", assetsBasePath: "/dynamic-routes" };

function getRuntimeConfig(): { buildId: string; assetsBasePath: string } {
  if (typeof __RINKA_RUNTIME_CONFIG__ !== "undefined" && __RINKA_RUNTIME_CONFIG__) {
    return __RINKA_RUNTIME_CONFIG__;
  }
  return DEFAULT_RUNTIME_CONFIG;
}

export type ResolveLoaderEnvParams = {
  hostEnv: Record<string, unknown>;
  /** `ExecutionContext.exports` of the host Worker (required for loopback bindings). */
  exports: RinkaCtxExports | undefined;
  /** Env names copied from the host env (structured-clonable values / service bindings). */
  bindings: readonly string[];
  /** `ctx.exports` loopbacks, keyed by the name the isolate sees. */
  loopbacks?: Readonly<Record<string, LoopbackDeclaration>>;
  routeId: string;
};

/**
 * Builds the `env` handed to `LOADER.get()`. Worker Loader serializes this
 * object into the dynamic Worker, so only structured-clonable values and Service
 * Binding stubs may appear here. Env bindings are copied from the host env as-is;
 * loopbacks become a derived stub via `ctx.exports[export]({ props })` (the bare
 * loopback object does NOT survive serialization, so a derived stub is always
 * created).
 */
export function resolveLoaderEnv(params: ResolveLoaderEnvParams): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const name of params.bindings) {
    if (!(name in params.hostEnv)) {
      throw new Error(
        `rinka: dynamic route "${params.routeId}" missing host env binding "${name}"`,
      );
    }
    out[name] = params.hostEnv[name];
  }

  for (const [name, declaration] of Object.entries(params.loopbacks ?? {})) {
    const exported = params.exports?.[declaration.export];
    if (exported == null) {
      throw new Error(
        `rinka: dynamic route "${params.routeId}" binding "${name}" needs ctx.exports.${declaration.export} — ` +
          `export the WorkerEntrypoint class from the host entry module`,
      );
    }
    if (typeof exported !== "function") {
      throw new Error(
        `rinka: dynamic route "${params.routeId}" binding "${name}" — ` +
          `ctx.exports.${declaration.export} is not callable`,
      );
    }
    out[name] = (exported as RinkaLoopbackFactory)({ props: declaration.props ?? {} });
  }

  return out;
}

export type DelegateDynamicRouteFetchParams = {
  request: Request;
  env: LoaderCapableEnv & { LOADER: RinkaWorkerLoader };
  /** `ExecutionContext.exports` of the host Worker; required for loopback bindings. */
  exports?: RinkaCtxExports;
  routeId: string;
  bindings: readonly string[];
  loopbacks?: Readonly<Record<string, LoopbackDeclaration>>;
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

// Marker prefix so a failed route-asset load (a rinka misconfiguration) can be
// told apart from an error thrown by the dynamic Worker's own handler.
const ASSET_LOAD_ERROR_PREFIX = "rinka: dynamic route asset";

async function loadRouteCode(
  env: LoaderCapableEnv & { LOADER: RinkaWorkerLoader },
  routeId: string,
  request: Request,
): Promise<string> {
  const assets = env.ASSETS;
  if (!assets) {
    throw new Error(
      `${ASSET_LOAD_ERROR_PREFIX} loader requires env.ASSETS — bind static assets and set assets.run_worker_first`,
    );
  }
  const url = new URL(`${getRuntimeConfig().assetsBasePath}/${routeId}.js`, request.url);
  const response = await assets.fetch(url);
  if (!response.ok) {
    throw new Error(`${ASSET_LOAD_ERROR_PREFIX} ${url.pathname} not found (${response.status})`);
  }
  return response.text();
}

export async function delegateDynamicRouteFetch(
  params: DelegateDynamicRouteFetchParams,
): Promise<Response> {
  const logError = params.logError ?? defaultLogError;

  let loaderEnv: Record<string, unknown>;
  try {
    loaderEnv = resolveLoaderEnv({
      hostEnv: params.env,
      exports: params.exports,
      bindings: params.bindings,
      loopbacks: params.loopbacks,
      routeId: params.routeId,
    });
  } catch (error) {
    logError("rinka: failed to resolve loader env", {
      routeId: params.routeId,
      error,
    });
    return moduleUnavailableResponse();
  }

  // Mark the isolate so its code (and the badge) can tell it runs dynamically,
  // and log the delegation for Workers Logs / `wrangler tail` visibility.
  loaderEnv[RINKA_ROUTE_ID_ENV_KEY] = params.routeId;
  console.log(`[rinka] delegating to dynamic Worker: ${params.routeId}`);

  // Key the isolate by id + build id so changed route code loads a fresh isolate.
  const stub = params.env.LOADER.get(
    `${params.routeId}@${getRuntimeConfig().buildId}`,
    async () => {
      const code = await loadRouteCode(params.env, params.routeId, params.request);
      return {
        compatibilityDate: "2026-05-01",
        compatibilityFlags: ["nodejs_compat"],
        mainModule: "main.js",
        modules: { "main.js": code },
        env: loaderEnv,
        // globalOutbound omitted: inherit the host Worker's outbound so dynamic
        // routes can make subrequests (e.g. fetch an upstream API). Set it to a
        // Fetcher (or null) to sandbox network access instead.
      };
    },
  );

  try {
    return await stub.getEntrypoint().fetch(params.request);
  } catch (error) {
    if (error instanceof Error && error.message.includes(ASSET_LOAD_ERROR_PREFIX)) {
      logError("rinka: failed to load dynamic route asset", {
        routeId: params.routeId,
        error,
      });
      if (params.allowInlineFallback) return params.inlineFetch();
      return moduleUnavailableResponse();
    }
    throw error;
  }
}
