/**
 * Binding delivery policies for Worker Loader (Dynamic Worker) envs.
 *
 * Per the Cloudflare Worker Loader API, `WorkerCode.env` is serialized and
 * transferred into the dynamic Worker. Only two kinds of values survive that
 * transfer:
 *
 *   1. structured-clonable values (string vars, plain objects, ...)
 *   2. Service Binding stubs, including `ctx.exports` loopback bindings
 *
 * Platform bindings (KV / R2 / D1 / DO namespaces / Queues / AI / Images...)
 * are NOT structured-clonable. The official pattern is to export a
 * `WorkerEntrypoint` proxy class from the loader Worker and pass
 * `ctx.exports.Proxy({ props })` stubs instead. Each binding a dynamic route
 * declares must therefore be classified so both build (validation) and
 * runtime (env resolution) know how to deliver it.
 */
export type BindingPolicy =
  /** Structured-clonable value (string var, secret, plain JSON). Copied as-is. */
  | { mode: "primitive" }
  /** Service Binding stub already present on the host env. Passed as-is. */
  | { mode: "service" }
  /**
   * Platform binding that must be wrapped by a `WorkerEntrypoint` proxy
   * exported from the host Worker entry module. Resolved at runtime via
   * `ctx.exports[proxyExport]({ props })` — a derived stub is always created
   * because the bare loopback object does not survive Worker Loader env
   * serialization. `props` (default `{}`) is baked into the generated
   * manifest, so it must be JSON-serializable.
   */
  | { mode: "proxy"; proxyExport: string; props?: Record<string, unknown> }
  /** Never allowed in a dynamic route. Build fails with `reason`. */
  | { mode: "forbidden"; reason: string };

export type BindingPolicyMap = Record<string, BindingPolicy>;

/**
 * Type-safe policy map builder: keys are constrained to the host's `Env`, so
 * a typo'd binding name fails the host's typecheck instead of surfacing as an
 * "unregistered binding" build error later.
 *
 *   bindingPolicies: defineBindingPolicies<Env>({ RATE_LIMIT_KV: { ... } })
 */
export function defineBindingPolicies<TEnv extends object>(policies: {
  readonly [K in keyof TEnv]?: BindingPolicy;
}): BindingPolicyMap {
  return policies as BindingPolicyMap;
}

/** A binding as recorded in the generated manifest: policy applied at build time. */
export type DynamicRouteBinding =
  | { name: string; mode: "primitive" }
  | { name: string; mode: "service" }
  | { name: string; mode: "proxy"; proxyExport: string; props?: Record<string, unknown> };

export type BindingPolicyViolation =
  | { kind: "unregistered-binding"; binding: string }
  | { kind: "forbidden-binding"; binding: string; reason: string };

/**
 * Policies every host inherits. `IMAGES` has no RPC-safe proxy yet and its
 * capability cannot be structured-cloned, so it stays build-time forbidden.
 * Hosts extend/override via the plugin's `bindingPolicies` option.
 */
export const defaultBindingPolicies: BindingPolicyMap = {
  IMAGES: {
    mode: "forbidden",
    reason: "IMAGES cannot be structured-cloned into a Worker Loader env and has no proxy",
  },
};

export function resolveBindingPolicies(
  bindings: readonly string[],
  policies: BindingPolicyMap,
): { resolved: DynamicRouteBinding[]; violations: BindingPolicyViolation[] } {
  const resolved: DynamicRouteBinding[] = [];
  const violations: BindingPolicyViolation[] = [];

  for (const name of bindings) {
    const policy = policies[name];
    if (!policy) {
      violations.push({ kind: "unregistered-binding", binding: name });
      continue;
    }
    switch (policy.mode) {
      case "forbidden":
        violations.push({ kind: "forbidden-binding", binding: name, reason: policy.reason });
        break;
      case "proxy":
        resolved.push(
          policy.props === undefined
            ? { name, mode: "proxy", proxyExport: policy.proxyExport }
            : { name, mode: "proxy", proxyExport: policy.proxyExport, props: policy.props },
        );
        break;
      case "primitive":
      case "service":
        resolved.push({ name, mode: policy.mode });
        break;
    }
  }

  return { resolved, violations };
}
