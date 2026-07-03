import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type {
  HibanaFetcher,
  HibanaWorkerLoader,
  HibanaWorkerLoaderWorkerCode,
} from "../cloudflare-types";
import {
  clearDynamicRouteModuleCacheForTests,
  dynamic,
  registerDynamicRouteManifest,
} from "../index";

describe("dynamic()", () => {
  const executionCtx = {
    waitUntil: () => {},
    passThroughOnException: () => {},
  } as unknown as ExecutionContext;

  afterEach(() => {
    registerDynamicRouteManifest({});
    clearDynamicRouteModuleCacheForTests();
  });

  it("returns a route that preserves handler behavior without LOADER bindings", async () => {
    const inner = new Hono().get("/ping", (c) => c.text("pong"));
    const wrapped = dynamic(inner, { id: "ping", bindings: [] });

    const res = await wrapped.fetch(new Request("http://localhost/ping"), {}, executionCtx);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("pong");
  });

  it("delegates to Worker Loader when bindings and manifest entry exist", async () => {
    registerDynamicRouteManifest({
      ping: {
        assetPath: "/dynamic-routes/ping.js",
        bindings: [],
      },
    });

    const inner = new Hono().get("/ping", (c) => c.text("inline"));
    const wrapped = dynamic(inner, { id: "ping", bindings: [] });

    const loaderFetch = vi.fn<() => Promise<Response>>(async () => new Response("loaded"));
    const loaderGet = vi.fn<
      (
        id: string | null,
        getCode: () => HibanaWorkerLoaderWorkerCode,
      ) => {
        getEntrypoint: () => { fetch: typeof loaderFetch };
      }
    >((_id, _getCode) => ({
      getEntrypoint: () => ({ fetch: loaderFetch }),
    }));
    const loader = { get: loaderGet } as unknown as HibanaWorkerLoader;
    const assetsFetch = vi.fn<() => Promise<Response>>(
      async () => new Response('export default { fetch() { return new Response("loaded"); } }'),
    );
    const assets = { fetch: assetsFetch } as unknown as HibanaFetcher;

    const env = {
      LOADER: loader,
      ASSETS: assets,
    };

    const res = await wrapped.fetch(new Request("http://localhost/ping"), env, executionCtx);

    expect(await res.text()).toBe("loaded");
    expect(loaderGet).toHaveBeenCalledOnce();
    expect(assetsFetch).toHaveBeenCalledOnce();

    await wrapped.fetch(new Request("http://localhost/ping"), env, executionCtx);
    expect(assetsFetch).toHaveBeenCalledOnce();
  });

  it("strips the mount prefix before delegating to the Worker Loader entrypoint", async () => {
    registerDynamicRouteManifest({
      health: {
        assetPath: "/dynamic-routes/health.js",
        bindings: [],
      },
    });

    const inner = new Hono().get("/", (c) => c.text("inline"));
    const wrapped = dynamic(inner, { id: "health", bindings: [] });
    const app = new Hono().basePath("/v1").route("/health", wrapped);

    const delegated = new Hono().get("/", (c) => c.text("delegated"));
    const loaderFetch = vi.fn<(req: Request) => Promise<Response>>(async (req) =>
      delegated.fetch(req),
    );
    const loaderGet = vi.fn<
      (
        id: string | null,
        getCode: () => HibanaWorkerLoaderWorkerCode,
      ) => {
        getEntrypoint: () => { fetch: typeof loaderFetch };
      }
    >((_id, _getCode) => ({
      getEntrypoint: () => ({ fetch: loaderFetch }),
    }));
    const loader = { get: loaderGet } as unknown as HibanaWorkerLoader;
    const assets = {
      fetch: vi.fn<() => Promise<Response>>(
        async () => new Response('export default { fetch() { return new Response("loaded"); } }'),
      ),
    } as unknown as HibanaFetcher;

    const res = await app.fetch(
      new Request("http://localhost/v1/health"),
      { LOADER: loader, ASSETS: assets },
      executionCtx,
    );

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("delegated");
    expect(loaderFetch).toHaveBeenCalledOnce();
    const delegatedRequest = loaderFetch.mock.calls[0]?.[0];
    expect(delegatedRequest).toBeDefined();
    expect(new URL(delegatedRequest!.url).pathname).toBe("/");
  });

  it("preserves request method and body when stripping the mount prefix", async () => {
    registerDynamicRouteManifest({
      health: {
        assetPath: "/dynamic-routes/health.js",
        bindings: [],
      },
    });

    const inner = new Hono().post("/", (c) => c.text("inline"));
    const wrapped = dynamic(inner, { id: "health", bindings: [] });
    const app = new Hono().basePath("/v1").route("/health", wrapped);

    const body = { ping: "pong" };
    const delegated = new Hono().post("/", async (c) => c.json(await c.req.json()));
    const loaderFetch = vi.fn<(req: Request) => Promise<Response>>(async (req) =>
      delegated.fetch(req),
    );
    const loaderGet = vi.fn<
      (
        id: string | null,
        getCode: () => HibanaWorkerLoaderWorkerCode,
      ) => {
        getEntrypoint: () => { fetch: typeof loaderFetch };
      }
    >((_id, _getCode) => ({
      getEntrypoint: () => ({ fetch: loaderFetch }),
    }));
    const loader = { get: loaderGet } as unknown as HibanaWorkerLoader;
    const assets = {
      fetch: vi.fn<() => Promise<Response>>(
        async () => new Response('export default { fetch() { return new Response("loaded"); } }'),
      ),
    } as unknown as HibanaFetcher;

    const res = await app.fetch(
      new Request("http://localhost/v1/health", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
      { LOADER: loader, ASSETS: assets },
      executionCtx,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(body);
    expect(loaderFetch).toHaveBeenCalledOnce();
    const delegatedRequest = loaderFetch.mock.calls[0]?.[0];
    expect(delegatedRequest).toBeDefined();
    expect(delegatedRequest!.method).toBe("POST");
    expect(new URL(delegatedRequest!.url).pathname).toBe("/");
  });

  it("resolves proxy bindings via executionCtx exports when delegating", async () => {
    registerDynamicRouteManifest({
      poc: {
        assetPath: "/dynamic-routes/poc.js",
        bindings: [{ name: "RATE_LIMIT_KV", mode: "proxy", proxyExport: "RateLimitKvProxy" }],
      },
    });

    const inner = new Hono().get("/", (c) => c.text("inline"));
    const wrapped = dynamic(inner, { id: "poc", bindings: ["RATE_LIMIT_KV"] });

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
    const loader = { get: loaderGet } as unknown as HibanaWorkerLoader;
    const assets = {
      fetch: vi.fn<() => Promise<Response>>(
        async () => new Response('export default { fetch() { return new Response("loaded"); } }'),
      ),
    } as unknown as HibanaFetcher;

    const ctxWithExports = {
      waitUntil: () => {},
      passThroughOnException: () => {},
      exports: { RateLimitKvProxy: factory },
    } as unknown as ExecutionContext;

    const res = await wrapped.fetch(
      new Request("http://localhost/"),
      { LOADER: loader, ASSETS: assets, RATE_LIMIT_KV: { rawPlatformBinding: true } },
      ctxWithExports,
    );

    expect(await res.text()).toBe("loaded");
    expect(factory).toHaveBeenCalledWith({ props: {} });
    expect(loaderGet).toHaveBeenCalledOnce();
  });

  it("resolves D1 proxy bindings via executionCtx exports when delegating", async () => {
    registerDynamicRouteManifest({
      users: {
        assetPath: "/dynamic-routes/users.js",
        bindings: [{ name: "USER_DB", mode: "proxy", proxyExport: "D1DbProxy" }],
      },
    });

    const inner = new Hono().get("/", (c) => c.text("inline"));
    const wrapped = dynamic(inner, { id: "users", bindings: ["USER_DB"] });

    const stub = { query: () => {}, first: () => {} };
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
      expect(getCode().env).toEqual({ USER_DB: stub });
      return { getEntrypoint: () => ({ fetch: loaderFetch }) };
    });
    const loader = { get: loaderGet } as unknown as HibanaWorkerLoader;
    const assets = {
      fetch: vi.fn<() => Promise<Response>>(
        async () => new Response('export default { fetch() { return new Response("loaded"); } }'),
      ),
    } as unknown as HibanaFetcher;

    const ctxWithExports = {
      waitUntil: () => {},
      passThroughOnException: () => {},
      exports: { D1DbProxy: factory },
    } as unknown as ExecutionContext;

    const res = await wrapped.fetch(
      new Request("http://localhost/"),
      { LOADER: loader, ASSETS: assets, USER_DB: { rawPlatformBinding: true } },
      ctxWithExports,
    );

    expect(await res.text()).toBe("loaded");
    expect(factory).toHaveBeenCalledWith({ props: {} });
    expect(loaderGet).toHaveBeenCalledOnce();
  });

  it("returns 502 for proxy bindings when ctx.exports is unavailable", async () => {
    registerDynamicRouteManifest({
      poc: {
        assetPath: "/dynamic-routes/poc.js",
        bindings: [{ name: "RATE_LIMIT_KV", mode: "proxy", proxyExport: "RateLimitKvProxy" }],
      },
    });

    const inner = new Hono().get("/", (c) => c.text("inline"));
    const wrapped = dynamic(inner, { id: "poc", bindings: ["RATE_LIMIT_KV"] });

    const loaderGet = vi.fn<
      () => {
        getEntrypoint: () => { fetch: () => Promise<Response> };
      }
    >(() => ({
      getEntrypoint: () => ({
        fetch: vi.fn<() => Promise<Response>>(async () => new Response("loaded")),
      }),
    }));
    const loader = { get: loaderGet } as unknown as HibanaWorkerLoader;
    const assets = {
      fetch: vi.fn<() => Promise<Response>>(
        async () => new Response('export default { fetch() { return new Response("loaded"); } }'),
      ),
    } as unknown as HibanaFetcher;

    const res = await wrapped.fetch(
      new Request("http://localhost/"),
      { LOADER: loader, ASSETS: assets, RATE_LIMIT_KV: { rawPlatformBinding: true } },
      executionCtx,
    );

    expect(res.status).toBe(502);
    expect(loaderGet).not.toHaveBeenCalled();
  });

  it("returns 502 when loader asset is missing", async () => {
    registerDynamicRouteManifest({
      "missing-asset": {
        assetPath: "/dynamic-routes/missing-asset.js",
        bindings: [],
      },
    });

    const inner = new Hono().get("/ping", (c) => c.text("inline"));
    const wrapped = dynamic(inner, { id: "missing-asset", bindings: [] });

    const loaderGet = vi.fn<
      () => {
        getEntrypoint: () => { fetch: () => Promise<Response> };
      }
    >(() => ({
      getEntrypoint: () => ({
        fetch: vi.fn<() => Promise<Response>>(async () => new Response("loaded")),
      }),
    }));
    const loader = { get: loaderGet } as unknown as HibanaWorkerLoader;
    const assets = {
      fetch: vi.fn<() => Promise<Response>>(async () => new Response("missing", { status: 404 })),
    } as unknown as HibanaFetcher;

    const res = await wrapped.fetch(
      new Request("http://localhost/ping"),
      { LOADER: loader, ASSETS: assets },
      executionCtx,
    );

    expect(res.status).toBe(502);
    expect(loaderGet).not.toHaveBeenCalled();
  });
});
