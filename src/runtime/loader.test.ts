import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type {
  HibanaFetcher,
  HibanaWorkerLoader,
  HibanaWorkerLoaderWorkerCode,
} from "../cloudflare-types";
import {
  clearDynamicRouteModuleCacheForTests,
  delegateDynamicRouteFetch,
  type DynamicRouteEntry,
  type LoaderCapableEnv,
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
    clearDynamicRouteModuleCacheForTests();
  });

  it("forwards the request to a Worker Loader entrypoint", async () => {
    const entry: DynamicRouteEntry = {
      assetPath: "/dynamic-routes/ping.js",
      bindings: [],
    };
    const loaderFetch = vi.fn<() => Promise<Response>>(async () => new Response("loaded"));
    const loaderGet = vi.fn<
      (
        id: string | null,
        getCode: () => HibanaWorkerLoaderWorkerCode,
      ) => {
        getEntrypoint: () => { fetch: typeof loaderFetch };
      }
    >((_id, getCode) => {
      const code = getCode();
      expect(code.mainModule).toBe("main.js");
      expect(code.modules["main.js"]).toContain("export default");
      return {
        getEntrypoint: () => ({ fetch: loaderFetch }),
      };
    });
    const loader = { get: loaderGet } as unknown as HibanaWorkerLoader;
    const assetsFetch = vi.fn<(input: URL) => Promise<Response>>(
      async () => new Response('export default { fetch() { return new Response("loaded"); } }'),
    );
    const assets = { fetch: assetsFetch } as unknown as HibanaFetcher;

    const res = await delegateDynamicRouteFetch({
      request: new Request("http://localhost/ping"),
      env: { LOADER: loader, ASSETS: assets } as LoaderCapableEnv & {
        LOADER: HibanaWorkerLoader;
        ASSETS: HibanaFetcher;
      },
      routeId: "ping",
      entry,
      inlineFetch: async () => new Response("inline"),
    });

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("loaded");
    expect(loaderGet).toHaveBeenCalledOnce();
    expect(assetsFetch).toHaveBeenCalledOnce();
    // The asset URL must stay on the request's own origin: dev resolves the
    // ASSETS binding through the Vite server, which 403s unknown hosts.
    const fetchedUrl = assetsFetch.mock.calls[0]?.[0];
    expect(fetchedUrl?.href).toBe("http://localhost/dynamic-routes/ping.js");

    await delegateDynamicRouteFetch({
      request: new Request("http://localhost/ping"),
      env: { LOADER: loader, ASSETS: assets } as LoaderCapableEnv & {
        LOADER: HibanaWorkerLoader;
        ASSETS: HibanaFetcher;
      },
      routeId: "ping",
      entry,
      inlineFetch: async () => new Response("inline"),
    });
    expect(assetsFetch).toHaveBeenCalledOnce();
  });

  it("returns 502 when the asset is missing unless inline fallback is allowed", async () => {
    const entry: DynamicRouteEntry = {
      assetPath: "/dynamic-routes/ping.js",
      bindings: [],
    };
    const assetsFetch = vi.fn<() => Promise<Response>>(
      async () => new Response("missing", { status: 404 }),
    );
    const assets = { fetch: assetsFetch } as unknown as HibanaFetcher;
    const inlineFetch = vi.fn<() => Promise<Response>>(async () => new Response("inline"));
    const loaderGet = vi.fn<() => { getEntrypoint: () => { fetch: () => Promise<Response> } }>();

    const blocked = await delegateDynamicRouteFetch({
      request: new Request("http://localhost/ping"),
      env: { LOADER: { get: loaderGet } as unknown as HibanaWorkerLoader, ASSETS: assets },
      routeId: "ping",
      entry,
      inlineFetch,
    });
    expect(blocked.status).toBe(502);
    expect(inlineFetch).not.toHaveBeenCalled();

    inlineFetch.mockClear();
    const fallback = await delegateDynamicRouteFetch({
      request: new Request("http://localhost/ping"),
      env: { LOADER: { get: loaderGet } as unknown as HibanaWorkerLoader, ASSETS: assets },
      routeId: "ping-fallback",
      entry: { ...entry, assetPath: "/dynamic-routes/ping-fallback.js" },
      inlineFetch,
      allowInlineFallback: true,
    });
    expect(await fallback.text()).toBe("inline");
    expect(inlineFetch).toHaveBeenCalledOnce();
  });

  it("passes derived proxy stubs from ctx.exports into the loader env", async () => {
    const entry: DynamicRouteEntry = {
      assetPath: "/dynamic-routes/poc.js",
      bindings: [{ name: "RATE_LIMIT_KV", mode: "proxy", proxyExport: "RateLimitKvProxy" }],
    };
    const stub = { get: () => {}, put: () => {} };
    const factory = vi.fn<(options: { props: Record<string, unknown> }) => typeof stub>(() => stub);
    const loaderFetch = vi.fn<() => Promise<Response>>(async () => new Response("loaded"));
    const loaderGet = vi.fn<
      (
        id: string | null,
        getCode: () => HibanaWorkerLoaderWorkerCode,
      ) => {
        getEntrypoint: () => { fetch: typeof loaderFetch };
      }
    >((_id, getCode) => {
      expect(getCode().env).toEqual({ RATE_LIMIT_KV: stub });
      return { getEntrypoint: () => ({ fetch: loaderFetch }) };
    });
    const assets = {
      fetch: vi.fn<() => Promise<Response>>(
        async () => new Response('export default { fetch() { return new Response("loaded"); } }'),
      ),
    } as unknown as HibanaFetcher;

    const res = await delegateDynamicRouteFetch({
      request: new Request("http://localhost/poc"),
      env: {
        LOADER: { get: loaderGet } as unknown as HibanaWorkerLoader,
        ASSETS: assets,
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

  it("returns 502 when the loader env cannot be resolved", async () => {
    const entry: DynamicRouteEntry = {
      assetPath: "/dynamic-routes/ping.js",
      bindings: [{ name: "RATE_LIMIT_KV", mode: "proxy", proxyExport: "RateLimitKvProxy" }],
    };
    const logError = vi.fn<(message: string, fields: Record<string, unknown>) => void>();
    const loaderGet = vi.fn<() => { getEntrypoint: () => { fetch: () => Promise<Response> } }>();
    const assets = {
      fetch: vi.fn<() => Promise<Response>>(
        async () => new Response('export default { fetch() { return new Response("loaded"); } }'),
      ),
    } as unknown as HibanaFetcher;

    const res = await delegateDynamicRouteFetch({
      request: new Request("http://localhost/ping"),
      env: { LOADER: { get: loaderGet } as unknown as HibanaWorkerLoader, ASSETS: assets },
      routeId: "ping",
      entry,
      inlineFetch: async () => new Response("inline"),
      logError,
    });

    expect(res.status).toBe(502);
    expect(loaderGet).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalledWith(
      "hibana: failed to resolve loader env",
      expect.objectContaining({ routeId: "ping" }),
    );
  });
});
