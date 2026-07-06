import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { RinkaWorkerLoader, RinkaWorkerLoaderWorkerCode } from "../cloudflare-types";
import {
  clearDynamicModulesForTests,
  dynamic,
  registerDynamicModules,
  registerDynamicRouteManifest,
} from "../index";

describe("dynamic()", () => {
  const executionCtx = {
    waitUntil: () => {},
    passThroughOnException: () => {},
  } as unknown as ExecutionContext;

  afterEach(() => {
    registerDynamicRouteManifest({});
    clearDynamicModulesForTests();
  });

  it("returns a route that preserves handler behavior without LOADER bindings", async () => {
    const inner = new Hono().get("/ping", (c) => c.text("pong"));
    const wrapped = dynamic(inner, { id: "ping", bindings: [] });

    const res = await wrapped.fetch(new Request("http://localhost/ping"), {}, executionCtx);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("pong");
  });

  it("delegates to Worker Loader when bindings and manifest entry exist", async () => {
    registerDynamicRouteManifest({ ping: { bindings: [] } });
    registerDynamicModules({
      ping: 'export default { fetch() { return new Response("loaded"); } }',
    });

    const inner = new Hono().get("/ping", (c) => c.text("inline"));
    const wrapped = dynamic(inner, { id: "ping", bindings: [] });

    const loaderFetch = vi.fn<() => Promise<Response>>(async () => new Response("loaded"));
    const loaderGet = vi.fn<
      (
        id: string | null,
        getCode: () => RinkaWorkerLoaderWorkerCode,
      ) => {
        getEntrypoint: () => { fetch: typeof loaderFetch };
      }
    >((_id, getCode) => {
      expect(getCode().modules["main.js"]).toContain("export default");
      return { getEntrypoint: () => ({ fetch: loaderFetch }) };
    });
    const env = { LOADER: { get: loaderGet } as unknown as RinkaWorkerLoader };

    const res = await wrapped.fetch(new Request("http://localhost/ping"), env, executionCtx);

    expect(await res.text()).toBe("loaded");
    expect(loaderGet).toHaveBeenCalledOnce();
  });

  it("strips the mount prefix before delegating to the Worker Loader entrypoint", async () => {
    registerDynamicRouteManifest({ health: { bindings: [] } });
    registerDynamicModules({ health: "export default {}" });

    const inner = new Hono().get("/", (c) => c.text("inline"));
    const wrapped = dynamic(inner, { id: "health", bindings: [] });
    const app = new Hono().basePath("/v1").route("/health", wrapped);

    const delegated = new Hono().get("/", (c) => c.text("delegated"));
    const loaderFetch = vi.fn<(req: Request) => Promise<Response>>(async (req) =>
      delegated.fetch(req),
    );
    const loaderGet = vi.fn<
      () => {
        getEntrypoint: () => { fetch: typeof loaderFetch };
      }
    >(() => ({ getEntrypoint: () => ({ fetch: loaderFetch }) }));
    const loader = { get: loaderGet } as unknown as RinkaWorkerLoader;

    const res = await app.fetch(
      new Request("http://localhost/v1/health"),
      { LOADER: loader },
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
    registerDynamicRouteManifest({ health: { bindings: [] } });
    registerDynamicModules({ health: "export default {}" });

    const inner = new Hono().post("/", (c) => c.text("inline"));
    const wrapped = dynamic(inner, { id: "health", bindings: [] });
    const app = new Hono().basePath("/v1").route("/health", wrapped);

    const body = { ping: "pong" };
    const delegated = new Hono().post("/", async (c) => c.json(await c.req.json()));
    const loaderFetch = vi.fn<(req: Request) => Promise<Response>>(async (req) =>
      delegated.fetch(req),
    );
    const loaderGet = vi.fn<
      () => {
        getEntrypoint: () => { fetch: typeof loaderFetch };
      }
    >(() => ({ getEntrypoint: () => ({ fetch: loaderFetch }) }));
    const loader = { get: loaderGet } as unknown as RinkaWorkerLoader;

    const res = await app.fetch(
      new Request("http://localhost/v1/health", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
      { LOADER: loader },
      executionCtx,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(body);
    const delegatedRequest = loaderFetch.mock.calls[0]?.[0];
    expect(delegatedRequest!.method).toBe("POST");
    expect(new URL(delegatedRequest!.url).pathname).toBe("/");
  });

  it("resolves proxy bindings via executionCtx exports when delegating", async () => {
    registerDynamicRouteManifest({
      poc: {
        bindings: [{ name: "RATE_LIMIT_KV", mode: "proxy", proxyExport: "RateLimitKvProxy" }],
      },
    });
    registerDynamicModules({ poc: "export default {}" });

    const inner = new Hono().get("/", (c) => c.text("inline"));
    const wrapped = dynamic(inner, { id: "poc", bindings: ["RATE_LIMIT_KV"] });

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
      expect(getCode().env).toEqual({ RATE_LIMIT_KV: stub });
      return { getEntrypoint: () => ({ fetch: loaderFetch }) };
    });

    const ctxWithExports = {
      waitUntil: () => {},
      passThroughOnException: () => {},
      exports: { RateLimitKvProxy: factory },
    } as unknown as ExecutionContext;

    const res = await wrapped.fetch(
      new Request("http://localhost/"),
      {
        LOADER: { get: loaderGet } as unknown as RinkaWorkerLoader,
        RATE_LIMIT_KV: { rawPlatformBinding: true },
      },
      ctxWithExports,
    );

    expect(await res.text()).toBe("loaded");
    expect(factory).toHaveBeenCalledWith({ props: {} });
    expect(loaderGet).toHaveBeenCalledOnce();
  });

  it("returns 502 for proxy bindings when ctx.exports is unavailable", async () => {
    registerDynamicRouteManifest({
      poc: {
        bindings: [{ name: "RATE_LIMIT_KV", mode: "proxy", proxyExport: "RateLimitKvProxy" }],
      },
    });
    registerDynamicModules({ poc: "export default {}" });

    const inner = new Hono().get("/", (c) => c.text("inline"));
    const wrapped = dynamic(inner, { id: "poc", bindings: ["RATE_LIMIT_KV"] });

    const loaderGet = vi.fn<() => { getEntrypoint: () => { fetch: () => Promise<Response> } }>();
    const loader = { get: loaderGet } as unknown as RinkaWorkerLoader;

    const res = await wrapped.fetch(
      new Request("http://localhost/"),
      { LOADER: loader, RATE_LIMIT_KV: { rawPlatformBinding: true } },
      executionCtx,
    );

    expect(res.status).toBe(502);
    expect(loaderGet).not.toHaveBeenCalled();
  });

  it("returns 502 when the dynamic module is not registered", async () => {
    registerDynamicRouteManifest({ "missing-module": { bindings: [] } });

    const inner = new Hono().get("/ping", (c) => c.text("inline"));
    const wrapped = dynamic(inner, { id: "missing-module", bindings: [] });

    const loaderGet = vi.fn<() => { getEntrypoint: () => { fetch: () => Promise<Response> } }>();
    const loader = { get: loaderGet } as unknown as RinkaWorkerLoader;

    const res = await wrapped.fetch(
      new Request("http://localhost/ping"),
      { LOADER: loader },
      executionCtx,
    );

    expect(res.status).toBe(502);
    expect(loaderGet).not.toHaveBeenCalled();
  });
});
