/**
 * Bindings a dynamic route can declare, restricted to what Worker Loader
 * (Dynamic Workers) officially supports.
 *
 * Worker Loader serializes the dynamic Worker's `env` before transferring it, so
 * only two kinds of value survive:
 *
 *   1. structured-clonable values (string vars, secrets, plain JSON) — declared
 *      as a plain env name and copied from the host env as-is;
 *   2. Service Bindings, including `ctx.exports` loopback stubs — declared as a
 *      loopback whose stub is derived at runtime via `ctx.exports[export]({ props })`.
 *
 * Platform bindings (KV / R2 / D1 / Queues / AI / ...) are not structured-clonable.
 * Expose them by wrapping the resource in a `WorkerEntrypoint` class exported
 * from the host entry module and declaring it as a loopback — no rinka-specific
 * proxy is required.
 */
export type LoopbackDeclaration = {
  /** Top-level export name of a `WorkerEntrypoint` class in the host entry module. */
  export: string;
  /** JSON-serializable props injected when deriving the stub. */
  props?: Record<string, unknown>;
};
