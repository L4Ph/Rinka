/** Minimal Cloudflare runtime shapes for rinka (avoid pulling workers-types into backend). */

export type RinkaWorkerLoaderWorkerCode = {
  compatibilityDate: string;
  compatibilityFlags?: string[];
  mainModule: string;
  modules: Record<string, string>;
  env: Record<string, unknown>;
  /**
   * Outbound for the dynamic Worker: omit to inherit the host Worker's outbound
   * (subrequests allowed), `null` to disable outbound, or a Fetcher to route it.
   */
  globalOutbound?: RinkaFetcher | null;
};

export type RinkaWorkerLoaderEntrypoint = {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
};

export type RinkaWorkerLoaderStub = {
  getEntrypoint(): RinkaWorkerLoaderEntrypoint;
};

export type RinkaWorkerLoader = {
  get(id: string | null, getCode: () => RinkaWorkerLoaderWorkerCode): RinkaWorkerLoaderStub;
};

export type RinkaFetcher = {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
};

/**
 * A `ctx.exports` loopback binding for a top-level `WorkerEntrypoint` export.
 * Callable to derive a stub with caller-specified `ctx.props` (requires the
 * `enable_ctx_exports` compatibility flag on the host Worker).
 */
export type RinkaLoopbackFactory = (options: { props: Record<string, unknown> }) => unknown;

/** Minimal shape of `ExecutionContext.exports` used by rinka. */
export type RinkaCtxExports = Record<string, unknown>;

export type RinkaExecutionContext = {
  exports?: RinkaCtxExports;
};
