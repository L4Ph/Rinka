import { Hono } from "hono";
import { describe, expect, it, vi } from "vite-plus/test";
import type {
  RinkaFetcher,
  RinkaWorkerLoader,
  RinkaWorkerLoaderWorkerCode,
} from "../cloudflare-types";
import { dynamic } from "../index";

const executionCtx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

function fakeAssets(code: string): RinkaFetcher {
  return { fetch: async () => new Response(code) };
}

function fakeLoader(handlers: {
  fetch?: (request: Request) => Promise<Response>;
  onId?: (id: string | null) => void;
}) {
  let pending:
    | (() => RinkaWorkerLoaderWorkerCode | Promise<RinkaWorkerLoaderWorkerCode>)
    | undefined;
  const fetchHandler = vi.fn<(request: Request) => Promise<Response>>(async (request) => {
    // Worker Loader runs the code callback lazily, on first use.
    if (pending) await pending();
    return handlers.fetch ? handlers.fetch(request) : new Response("loaded");
  });
  const get = vi.fn<
    (
      id: string | null,
      getCode: () => RinkaWorkerLoaderWorkerCode | Promise<RinkaWorkerLoaderWorkerCode>,
    ) => { getEntrypoint: () => { fetch: (request: Request) => Promise<Response> } }
  >((id, getCode) => {
    handlers.onId?.(id);
    pending = getCode;
    return { getEntrypoint: () => ({ fetch: fetchHandler }) };
  });
  return { loader: { get } as unknown as RinkaWorkerLoader, get, fetchHandler };
}

describe("dynamic()", () => {
  it("returns a route that preserves handler behavior without LOADER bindings", async () => {
    const inner = new Hono().get("/ping", (c) => c.text("pong"));
    const wrapped = dynamic(inner, { id: "ping", bindings: [] });

    const res = await wrapped.fetch(new Request("http://localhost/ping"), {}, executionCtx);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("pong");
  });

  it("delegates to Worker Loader when LOADER bindings exist", async () => {
    const inner = new Hono().get("/ping", (c) => c.text("inline"));
    const wrapped = dynamic(inner, { id: "ping", bindings: [] });

    const { loader, get, fetchHandler } = fakeLoader({});
    const env = { LOADER: loader, ASSETS: fakeAssets("export default {}") };

    const res = await wrapped.fetch(new Request("http://localhost/ping"), env, executionCtx);

    expect(await res.text()).toBe("loaded");
    expect(get).toHaveBeenCalledOnce();
    expect(get.mock.calls[0]?.[0]).toBe("ping@dev");
    expect(fetchHandler).toHaveBeenCalledOnce();
  });

  it("strips the mount prefix before delegating to the Worker Loader entrypoint", async () => {
    const inner = new Hono().get("/", (c) => c.text("inline"));
    const wrapped = dynamic(inner, { id: "health", bindings: [] });
    const app = new Hono().basePath("/v1").route("/health", wrapped);

    const { loader, fetchHandler } = fakeLoader({
      fetch: async (req) => new Hono().get("/", (c) => c.text("delegated")).fetch(req),
    });

    const res = await app.fetch(
      new Request("http://localhost/v1/health"),
      { LOADER: loader, ASSETS: fakeAssets("export default {}") },
      executionCtx,
    );

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("delegated");
    const delegatedRequest = fetchHandler.mock.calls[0]?.[0];
    expect(delegatedRequest).toBeDefined();
    expect(new URL(delegatedRequest!.url).pathname).toBe("/");
  });

  it("preserves request method and body when stripping the mount prefix", async () => {
    const inner = new Hono().post("/", (c) => c.text("inline"));
    const wrapped = dynamic(inner, { id: "health", bindings: [] });
    const app = new Hono().basePath("/v1").route("/health", wrapped);

    const body = { ping: "pong" };
    const { loader, fetchHandler } = fakeLoader({
      fetch: async (req) =>
        new Hono().post("/", async (c) => c.json(await c.req.json())).fetch(req),
    });

    const res = await app.fetch(
      new Request("http://localhost/v1/health", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
      { LOADER: loader, ASSETS: fakeAssets("export default {}") },
      executionCtx,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(body);
    const delegatedRequest = fetchHandler.mock.calls[0]?.[0];
    expect(delegatedRequest!.method).toBe("POST");
    expect(new URL(delegatedRequest!.url).pathname).toBe("/");
  });

  it("resolves loopback bindings via executionCtx exports when delegating", async () => {
    const inner = new Hono().get("/", (c) => c.text("inline"));
    const wrapped = dynamic(inner, {
      id: "poc",
      bindings: [],
      loopbacks: { STORAGE: { export: "MyKv" } },
    });

    const stub = { get: () => {}, put: () => {} };
    const factory = vi.fn<(options: { props: Record<string, unknown> }) => typeof stub>(() => stub);
    let isolateEnv: Record<string, unknown> | undefined;
    const loader = {
      get: (
        _id: string,
        getCode: () => RinkaWorkerLoaderWorkerCode | Promise<RinkaWorkerLoaderWorkerCode>,
      ) => ({
        getEntrypoint: () => ({
          fetch: async () => {
            isolateEnv = (await getCode()).env;
            return new Response("loaded");
          },
        }),
      }),
    } as unknown as RinkaWorkerLoader;

    const ctxWithExports = {
      waitUntil: () => {},
      passThroughOnException: () => {},
      exports: { MyKv: factory },
    } as unknown as ExecutionContext;

    const res = await wrapped.fetch(
      new Request("http://localhost/"),
      { LOADER: loader, ASSETS: fakeAssets("export default {}") },
      ctxWithExports,
    );

    expect(await res.text()).toBe("loaded");
    expect(isolateEnv).toEqual({ STORAGE: stub, __rinkaRouteId: "poc" });
    expect(factory).toHaveBeenCalledWith({ props: {} });
  });

  it("returns 502 for loopback bindings when ctx.exports is unavailable", async () => {
    const wrapped = dynamic(
      new Hono().get("/", (c) => c.text("inline")),
      {
        id: "poc",
        bindings: [],
        loopbacks: { STORAGE: { export: "MyKv" } },
      },
    );
    const { loader, get } = fakeLoader({});

    const res = await wrapped.fetch(
      new Request("http://localhost/"),
      { LOADER: loader, ASSETS: fakeAssets("export default {}") },
      executionCtx,
    );

    expect(res.status).toBe(502);
    expect(get).not.toHaveBeenCalled();
  });

  it("returns 502 when the route asset is missing", async () => {
    const wrapped = dynamic(
      new Hono().get("/ping", (c) => c.text("inline")),
      {
        id: "missing-module",
        bindings: [],
      },
    );
    const { get } = fakeLoader({});
    const assets: RinkaFetcher = { fetch: async () => new Response("nope", { status: 404 }) };

    const res = await wrapped.fetch(
      new Request("http://localhost/ping"),
      { LOADER: { get } as unknown as RinkaWorkerLoader, ASSETS: assets },
      executionCtx,
    );

    expect(res.status).toBe(502);
    expect(get).toHaveBeenCalledOnce();
  });

  it("does not delegate a path the wrapped route can't handle; a sibling serves it", async () => {
    const wrapped = dynamic(
      new Hono().get("/:id", (c) => c.text("shop")),
      {
        id: "shops",
        bindings: [],
      },
    );
    const { loader, get } = fakeLoader({});
    const app = new Hono().route("/shops", wrapped).route(
      "/shops",
      new Hono().get("/:id/photos/:index", (c) => c.text("sibling-photos")),
    );

    const res = await app.fetch(
      new Request("http://localhost/shops/1/photos/2"),
      { LOADER: loader, ASSETS: fakeAssets("export default {}") },
      executionCtx,
    );

    expect(await res.text()).toBe("sibling-photos");
    expect(get).not.toHaveBeenCalled();
  });

  it("routes each dynamic sibling at the same prefix to its own isolate", async () => {
    const wrappedShops = dynamic(
      new Hono().get("/:id", (c) => c.text("i")),
      {
        id: "shops",
        bindings: [],
      },
    );
    const wrappedPhotos = dynamic(
      new Hono().get("/:id/photos/:index", (c) => c.text("i")),
      {
        id: "photos",
        bindings: [],
      },
    );

    const delegatedIds: string[] = [];
    const { loader } = fakeLoader({
      fetch: async () => new Response("isolate"),
      onId: (id) => {
        delegatedIds.push((id ?? "").split("@")[0] ?? "");
      },
    });
    const env = { LOADER: loader, ASSETS: fakeAssets("export default {}") };
    const app = new Hono().route("/shops", wrappedShops).route("/shops", wrappedPhotos);

    await app.fetch(new Request("http://localhost/shops/1"), env, executionCtx);
    await app.fetch(new Request("http://localhost/shops/1/photos/2"), env, executionCtx);

    expect(delegatedIds).toEqual(["shops", "photos"]);
  });

  it("does not over-delegate when the wrapped route has global middleware", async () => {
    const passthrough = async (_c: unknown, next: () => Promise<void>) => {
      await next();
    };
    const wrapped = dynamic(
      new Hono().use(passthrough).get("/:id", (c) => c.text("shop")),
      {
        id: "shops",
        bindings: [],
      },
    );
    const { loader, get } = fakeLoader({});
    const app = new Hono().route("/shops", wrapped).route(
      "/shops",
      new Hono().get("/:id/photos/:index", (c) => c.text("sibling-photos")),
    );

    const res = await app.fetch(
      new Request("http://localhost/shops/1/photos/2"),
      { LOADER: loader, ASSETS: fakeAssets("export default {}") },
      executionCtx,
    );

    expect(await res.text()).toBe("sibling-photos");
    expect(get).not.toHaveBeenCalled();
  });
});
