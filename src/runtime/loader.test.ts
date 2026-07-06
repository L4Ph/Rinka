import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { RinkaWorkerLoader, RinkaWorkerLoaderWorkerCode } from "../cloudflare-types";
import {
  clearDynamicModulesForTests,
  delegateDynamicRouteFetch,
  type DynamicRouteEntry,
  getDynamicRouteId,
  type LoaderCapableEnv,
  registerDynamicModules,
  resolveLoaderEnv,
} from "./loader";

describe("resolveLoaderEnv", () => {
  it("copies primitive and service bindings from host env", () => {
    const resizeStub = { resizeFromUrl: () => {} };
    const hostEnv = { APP_URL: "http://localhost", RESIZE: resizeStub, UNRELATED: "x" };
    expect(
      resolveLoaderEnv({
        hostEnv,
        exports: undefined,
        bindings: [
          { name: "APP_URL", mode: "primitive" },
          { name: "RESIZE", mode: "service" },
        ],
        routeId: "test-route",
      }),
    ).toEqual({ APP_URL: "http://localhost", RESIZE: resizeStub });
  });

  it("throws when a declared binding is missing from the host env", () => {
    expect(() =>
      resolveLoaderEnv({
        hostEnv: {},
        exports: undefined,
        bindings: [{ name: "APP_URL", mode: "primitive" }],
        routeId: "missing-binding",
      }),
    ).toThrow(/missing host env binding "APP_URL"/);
  });

  it("derives serializable stubs from ctx.exports for proxy bindings", () => {
    // Bare ctx.exports loopback objects do not survive Worker Loader env
    // serialization (workerd: DataCloneError on LoopbackServiceStub), so a
    // derived stub must always be created via the factory call.
    const derived = { get: () => {}, put: () => {} };
    const factory = vi.fn<(options: { props: Record<string, unknown> }) => typeof derived>(
      () => derived,
    );
    const hostEnv = { RATE_LIMIT_KV: { rawPlatformBinding: true } };

    const loaderEnv = resolveLoaderEnv({
      hostEnv,
      exports: { RateLimitKvProxy: factory },
      bindings: [{ name: "RATE_LIMIT_KV", mode: "proxy", proxyExport: "RateLimitKvProxy" }],
      routeId: "poc",
    });

    // The raw platform binding must never leak into the loader env — only the stub.
    expect(loaderEnv).toEqual({ RATE_LIMIT_KV: derived });
    expect(factory).toHaveBeenCalledWith({ props: {} });
  });

  it("derives a props-scoped stub when the manifest carries props", () => {
    const derived = { get: () => {} };
    const factory = vi.fn<(options: { props: Record<string, unknown> }) => typeof derived>(
      () => derived,
    );

    const loaderEnv = resolveLoaderEnv({
      hostEnv: {},
      exports: { TenantKvProxy: factory },
      bindings: [
        { name: "TENANT_KV", mode: "proxy", proxyExport: "TenantKvProxy", props: { tenant: "a" } },
      ],
      routeId: "poc",
    });

    expect(loaderEnv).toEqual({ TENANT_KV: derived });
    expect(factory).toHaveBeenCalledWith({ props: { tenant: "a" } });
  });

  it("derives serializable stubs for D1 proxy bindings from ctx.exports", () => {
    const derived = { query: () => {}, first: () => {} };
    const factory = vi.fn<(options: { props: Record<string, unknown> }) => typeof derived>(
      () => derived,
    );
    const hostEnv = { USER_DB: { rawPlatformBinding: true } };

    const loaderEnv = resolveLoaderEnv({
      hostEnv,
      exports: { D1DbProxy: factory },
      bindings: [{ name: "USER_DB", mode: "proxy", proxyExport: "D1DbProxy" }],
      routeId: "users",
    });

    expect(loaderEnv).toEqual({ USER_DB: derived });
    expect(factory).toHaveBeenCalledWith({ props: {} });
  });

  it("throws a descriptive error when the proxy export is unavailable", () => {
    expect(() =>
      resolveLoaderEnv({
        hostEnv: { RATE_LIMIT_KV: {} },
        exports: undefined,
        bindings: [{ name: "RATE_LIMIT_KV", mode: "proxy", proxyExport: "RateLimitKvProxy" }],
        routeId: "poc",
      }),
    ).toThrow(/ctx\.exports\.RateLimitKvProxy/);

    expect(() =>
      resolveLoaderEnv({
        hostEnv: {},
        exports: { TenantKvProxy: { notCallable: true } },
        bindings: [{ name: "TENANT_KV", mode: "proxy", proxyExport: "TenantKvProxy" }],
        routeId: "poc",
      }),
    ).toThrow(/not callable/);
  });
});

describe("delegateDynamicRouteFetch", () => {
  afterEach(() => {
    clearDynamicModulesForTests();
  });

  it("hands the host-embedded module code to a Worker Loader entrypoint", async () => {
    registerDynamicModules({
      ping: 'export default { fetch() { return new Response("loaded"); } }',
    });
    const entry: DynamicRouteEntry = { bindings: [] };
    const loaderFetch = vi.fn<() => Promise<Response>>(async () => new Response("loaded"));
    const loaderGet = vi.fn<
      (
        id: string | null,
        getCode: () => RinkaWorkerLoaderWorkerCode,
      ) => {
        getEntrypoint: () => { fetch: typeof loaderFetch };
      }
    >((_id, getCode) => {
      const code = getCode();
      expect(code.mainModule).toBe("main.js");
      expect(code.modules["main.js"]).toContain("export default");
      return { getEntrypoint: () => ({ fetch: loaderFetch }) };
    });
    const loader = { get: loaderGet } as unknown as RinkaWorkerLoader;

    const res = await delegateDynamicRouteFetch({
      request: new Request("http://localhost/ping"),
      env: { LOADER: loader } as LoaderCapableEnv & { LOADER: RinkaWorkerLoader },
      routeId: "ping",
      entry,
      inlineFetch: async () => new Response("inline"),
    });

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("loaded");
    expect(loaderGet).toHaveBeenCalledOnce();
  });

  it("returns 502 when the module is not registered unless inline fallback is allowed", async () => {
    const entry: DynamicRouteEntry = { bindings: [] };
    const inlineFetch = vi.fn<() => Promise<Response>>(async () => new Response("inline"));
    const loaderGet = vi.fn<() => { getEntrypoint: () => { fetch: () => Promise<Response> } }>();
    const env = {
      LOADER: { get: loaderGet } as unknown as RinkaWorkerLoader,
    } as LoaderCapableEnv & {
      LOADER: RinkaWorkerLoader;
    };

    const blocked = await delegateDynamicRouteFetch({
      request: new Request("http://localhost/ping"),
      env,
      routeId: "ping",
      entry,
      inlineFetch,
    });
    expect(blocked.status).toBe(502);
    expect(inlineFetch).not.toHaveBeenCalled();

    inlineFetch.mockClear();
    const fallback = await delegateDynamicRouteFetch({
      request: new Request("http://localhost/ping"),
      env,
      routeId: "ping",
      entry,
      inlineFetch,
      allowInlineFallback: true,
    });
    expect(await fallback.text()).toBe("inline");
    expect(inlineFetch).toHaveBeenCalledOnce();
  });

  it("passes derived proxy stubs from ctx.exports into the loader env", async () => {
    registerDynamicModules({ poc: "export default { fetch() {} }" });
    const entry: DynamicRouteEntry = {
      bindings: [{ name: "RATE_LIMIT_KV", mode: "proxy", proxyExport: "RateLimitKvProxy" }],
    };
    const stub = { get: () => {}, put: () => {} };
    const factory = vi.fn<(options: { props: Record<string, unknown> }) => typeof stub>(() => stub);
    const loaderFetch = vi.fn<() => Promise<Response>>(async () => new Response("loaded"));
    const loaderGet = vi.fn<
      (
        id: string | null,
        getCode: () => RinkaWorkerLoaderWorkerCode,
      ) => {
        getEntrypoint: () => { fetch: typeof loaderFetch };
      }
    >((_id, getCode) => {
      // The raw platform binding must never leak; only the stub + rinka marker.
      expect(getCode().env).toEqual({ RATE_LIMIT_KV: stub, __rinkaRouteId: "poc" });
      return { getEntrypoint: () => ({ fetch: loaderFetch }) };
    });

    const res = await delegateDynamicRouteFetch({
      request: new Request("http://localhost/poc"),
      env: {
        LOADER: { get: loaderGet } as unknown as RinkaWorkerLoader,
        RATE_LIMIT_KV: { rawPlatformBinding: true },
      },
      exports: { RateLimitKvProxy: factory },
      routeId: "poc",
      entry,
      inlineFetch: async () => new Response("inline"),
    });

    expect(await res.text()).toBe("loaded");
    expect(factory).toHaveBeenCalledWith({ props: {} });
    expect(loaderGet).toHaveBeenCalledOnce();
  });

  it("injects the route id into the isolate env so it can self-identify", async () => {
    registerDynamicModules({ shop: "export default {}" });
    const entry: DynamicRouteEntry = { bindings: [] };
    let isolateEnv: Record<string, unknown> | undefined;
    const loaderGet = vi.fn<
      (
        id: string | null,
        getCode: () => RinkaWorkerLoaderWorkerCode,
      ) => {
        getEntrypoint: () => { fetch: () => Promise<Response> };
      }
    >((_id, getCode) => {
      isolateEnv = getCode().env;
      return { getEntrypoint: () => ({ fetch: async () => new Response("ok") }) };
    });

    await delegateDynamicRouteFetch({
      request: new Request("http://localhost/"),
      env: { LOADER: { get: loaderGet } as unknown as RinkaWorkerLoader } as LoaderCapableEnv & {
        LOADER: RinkaWorkerLoader;
      },
      routeId: "shop",
      entry,
      inlineFetch: async () => new Response("inline"),
    });

    expect(getDynamicRouteId(isolateEnv)).toBe("shop");
    // A host env (no marker) reports undefined.
    expect(getDynamicRouteId({ LOADER: {}, ASSETS: {} })).toBeUndefined();
  });

  it("keys the isolate by content hash so changed code busts the cache", async () => {
    const keys: string[] = [];
    const loaderGet = vi.fn<
      (id: string | null) => { getEntrypoint: () => { fetch: () => Promise<Response> } }
    >((id) => {
      keys.push(id ?? "");
      return { getEntrypoint: () => ({ fetch: async () => new Response("ok") }) };
    });
    const env = {
      LOADER: { get: loaderGet } as unknown as RinkaWorkerLoader,
    } as LoaderCapableEnv & {
      LOADER: RinkaWorkerLoader;
    };
    const entry: DynamicRouteEntry = { bindings: [] };
    const call = () =>
      delegateDynamicRouteFetch({
        request: new Request("http://localhost/"),
        env,
        routeId: "r",
        entry,
        inlineFetch: async () => new Response("inline"),
      });

    registerDynamicModules({ r: "export default { a: 1 }" });
    await call();
    clearDynamicModulesForTests();
    registerDynamicModules({ r: "export default { a: 2 }" });
    await call();

    expect(keys[0]).toMatch(/^r@/);
    expect(keys[1]).toMatch(/^r@/);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("returns 502 when the loader env cannot be resolved", async () => {
    registerDynamicModules({ ping: "export default { fetch() {} }" });
    const entry: DynamicRouteEntry = {
      bindings: [{ name: "RATE_LIMIT_KV", mode: "proxy", proxyExport: "RateLimitKvProxy" }],
    };
    const logError = vi.fn<(message: string, fields: Record<string, unknown>) => void>();
    const loaderGet = vi.fn<() => { getEntrypoint: () => { fetch: () => Promise<Response> } }>();

    const res = await delegateDynamicRouteFetch({
      request: new Request("http://localhost/ping"),
      env: { LOADER: { get: loaderGet } as unknown as RinkaWorkerLoader },
      routeId: "ping",
      entry,
      inlineFetch: async () => new Response("inline"),
      logError,
    });

    expect(res.status).toBe(502);
    expect(loaderGet).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalledWith(
      "rinka: failed to resolve loader env",
      expect.objectContaining({ routeId: "ping" }),
    );
  });
});
