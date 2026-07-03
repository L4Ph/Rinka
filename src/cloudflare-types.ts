/** Minimal Cloudflare runtime shapes for hibana (avoid pulling workers-types into backend). */

export type HibanaWorkerLoaderWorkerCode = {
  compatibilityDate: string;
  compatibilityFlags?: string[];
  mainModule: string;
  modules: Record<string, string>;
  env: Record<string, unknown>;
  globalOutbound: null;
};

export type HibanaWorkerLoaderEntrypoint = {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
};

export type HibanaWorkerLoaderStub = {
  getEntrypoint(): HibanaWorkerLoaderEntrypoint;
};

export type HibanaWorkerLoader = {
  get(id: string | null, getCode: () => HibanaWorkerLoaderWorkerCode): HibanaWorkerLoaderStub;
};

export type HibanaFetcher = {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
};

/**
 * A `ctx.exports` loopback binding for a top-level `WorkerEntrypoint` export.
 * Callable to derive a stub with caller-specified `ctx.props` (requires the
 * `enable_ctx_exports` compatibility flag on the host Worker).
 */
export type HibanaLoopbackFactory = (options: { props: Record<string, unknown> }) => unknown;

/** Minimal shape of `ExecutionContext.exports` used by hibana. */
export type HibanaCtxExports = Record<string, unknown>;

export type HibanaExecutionContext = {
  exports?: HibanaCtxExports;
};
