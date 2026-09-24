import { describe, expect, it, vi } from "vite-plus/test";
import type {
  RinkaFetcher,
  RinkaWorkerLoader,
  RinkaWorkerLoaderWorkerCode,
} from "../cloudflare-types";
import { delegateDynamicRouteFetch, getDynamicRouteId, resolveLoaderEnv } from "./loader";

function assetsReturning(code: string): RinkaFetcher {
  return { fetch: async () => new Response(code) };
}

describe("resolveLoaderEnv", () => {
  it("copies env bindings from the host env", () => {
    const serviceStub = { fetch: () => {} };
    const hostEnv = { APP_URL: "http://localhost", ANOTHER_WORKER: serviceStub, UNRELATED: "x" };
    expect(
      resolveLoaderEnv({
        hostEnv,
        exports: undefined,
        bindings: ["APP_URL", "ANOTHER_WORKER"],
        routeId: "test-route",
      }),
    ).toEqual({ APP_URL: "http://localhost", ANOTHER_WORKER: serviceStub });
  });

  it("throws when a declared env binding is missing from the host env", () => {
    expect(() =>
      resolveLoaderEnv({
        hostEnv: {},
        exports: undefined,
        bindings: ["APP_URL"],
        routeId: "missing-binding",
      }),
    ).toThrow(/missing host env binding "APP_URL"/);
  });

  it("derives a serializable stub from ctx.exports for a loopback binding", () => {
    // The bare ctx.exports loopback object does not survive Worker Loader env
    // serialization, so a derived stub is always created via the factory call.
    const derived = { get: () => {}, put: () => {} };
    const factory = vi.fn<(options: { props: Record<string, unknown> }) => typeof derived>(
      () => derived,
    );

    const loaderEnv = resolveLoaderEnv({
      hostEnv: {},
      exports: { MyKv: factory },
      bindings: [],
      loopbacks: { STORAGE: { export: "MyKv" } },
      routeId: "poc",
    });

    expect(loaderEnv).toEqual({ STORAGE: derived });
    expect(factory).toHaveBeenCalledWith({ props: {} });
  });

  it("derives a props-scoped stub when the declaration carries props", () => {
    const derived = { get: () => {} };
    const factory = vi.fn<(options: { props: Record<string, unknown> }) => typeof derived>(
      () => derived,
    );

    const loaderEnv = resolveLoaderEnv({
      hostEnv: {},
      exports: { MyKv: factory },
      bindings: [],
      loopbacks: { STORAGE: { export: "MyKv", props: { prefix: "t1" } } },
      routeId: "poc",
    });

    expect(loaderEnv).toEqual({ STORAGE: derived });
    expect(factory).toHaveBeenCalledWith({ props: { prefix: "t1" } });
  });

  it("throws a descriptive error when the loopback export is unavailable", () => {
    expect(() =>
      resolveLoaderEnv({
        hostEnv: {},
        exports: undefined,
        bindings: [],
        loopbacks: { STORAGE: { export: "MyKv" } },
        routeId: "poc",
      }),
    ).toThrow(/ctx\.exports\.MyKv/);

    expect(() =>
      resolveLoaderEnv({
        hostEnv: {},
        exports: { MyKv: { notCallable: true } },
        bindings: [],
        loopbacks: { STORAGE: { export: "MyKv" } },
        routeId: "poc",
      }),
    ).toThrow(/not callable/);
  });
});

describe("delegateDynamicRouteFetch", () => {
  // Mirrors Worker Loader semantics: the code callback runs lazily, when the
  // stub is first used (i.e. on fetch), not when get() is called.
  function loaderSpy() {
    let loadedCode: RinkaWorkerLoaderWorkerCode | undefined;
    const loaderFetch = vi.fn<() => Promise<Response>>(async () => new Response("loaded"));
    const loaderGet = vi.fn<
      (
        id: string | null,
        getCode: () => RinkaWorkerLoaderWorkerCode | Promise<RinkaWorkerLoaderWorkerCode>,
      ) => { getEntrypoint: () => { fetch: () => Promise<Response> } }
    >((_id, getCode) => ({
      getEntrypoint: () => ({
        fetch: async () => {
          loadedCode = await getCode();
          return loaderFetch();
        },
      }),
    }));
    const loader = { get: loaderGet } as unknown as RinkaWorkerLoader;
    return { loader, loaderGet, loaderFetch, getLoadedCode: () => loadedCode };
  }

  it("fetches the route code from ASSETS and hands it to the Worker Loader entrypoint", async () => {
    const { loader, loaderGet, loaderFetch, getLoadedCode } = loaderSpy();
    const assetsFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url =
        input instanceof URL ? input : new URL(typeof input === "string" ? input : input.url);
      expect(url.pathname).toBe("/dynamic-routes/ping.js");
      return new Response('export default { fetch() { return new Response("loaded"); } }');
    });
    const assets = { fetch: assetsFetch } as RinkaFetcher;

    const res = await delegateDynamicRouteFetch({
      request: new Request("http://localhost/ping"),
      env: { LOADER: loader, ASSETS: assets },
      routeId: "ping",
      bindings: [],
      inlineFetch: async () => new Response("inline"),
    });

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("loaded");
    expect(loaderGet).toHaveBeenCalledOnce();
    expect(loaderGet.mock.calls[0]?.[0]).toBe("ping@dev");
    expect(assetsFetch).toHaveBeenCalledOnce();
    expect(loaderFetch).toHaveBeenCalledOnce();

    const code = getLoadedCode();
    expect(code?.mainModule).toBe("main.js");
    expect(code?.modules["main.js"]).toContain("export default");
  });

  it("injects the route id into the isolate env so it can self-identify", async () => {
    let isolateEnv: Record<string, unknown> | undefined;
    const loader = {
      get: (
        _id: string,
        getCode: () => RinkaWorkerLoaderWorkerCode | Promise<RinkaWorkerLoaderWorkerCode>,
      ) => ({
        getEntrypoint: () => ({
          fetch: async () => {
            isolateEnv = (await getCode()).env;
            return new Response("ok");
          },
        }),
      }),
    } as unknown as RinkaWorkerLoader;

    await delegateDynamicRouteFetch({
      request: new Request("http://localhost/"),
      env: { LOADER: loader, ASSETS: assetsReturning("export default {}") },
      routeId: "shop",
      bindings: [],
      inlineFetch: async () => new Response("inline"),
    });

    expect(getDynamicRouteId(isolateEnv)).toBe("shop");
    expect(getDynamicRouteId({ LOADER: {}, ASSETS: {} })).toBeUndefined();
  });

  it("passes derived loopback stubs from ctx.exports into the loader env", async () => {
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
            return new Response("ok");
          },
        }),
      }),
    } as unknown as RinkaWorkerLoader;

    await delegateDynamicRouteFetch({
      request: new Request("http://localhost/"),
      env: { LOADER: loader, ASSETS: assetsReturning("export default {}") },
      exports: { MyKv: factory },
      routeId: "poc",
      bindings: [],
      loopbacks: { STORAGE: { export: "MyKv" } },
      inlineFetch: async () => new Response("inline"),
    });

    expect(isolateEnv).toEqual({ STORAGE: stub, __rinkaRouteId: "poc" });
    expect(factory).toHaveBeenCalledWith({ props: {} });
  });

  it("returns 502 when the route asset is missing unless inline fallback is allowed", async () => {
    const { loader, loaderGet } = loaderSpy();
    const assets: RinkaFetcher = { fetch: async () => new Response("nope", { status: 404 }) };
    const inlineFetch = vi.fn<() => Promise<Response>>(async () => new Response("inline"));
    const env = { LOADER: loader, ASSETS: assets };

    const blocked = await delegateDynamicRouteFetch({
      request: new Request("http://localhost/ping"),
      env,
      routeId: "ping",
      bindings: [],
      inlineFetch,
    });
    expect(blocked.status).toBe(502);
    expect(inlineFetch).not.toHaveBeenCalled();

    const fallback = await delegateDynamicRouteFetch({
      request: new Request("http://localhost/ping"),
      env,
      routeId: "ping",
      bindings: [],
      inlineFetch,
      allowInlineFallback: true,
    });
    expect(await fallback.text()).toBe("inline");
    expect(inlineFetch).toHaveBeenCalledOnce();
    expect(loaderGet).toHaveBeenCalledTimes(2);
  });

  it("returns 502 when the loader env cannot be resolved", async () => {
    const { loader, loaderGet } = loaderSpy();
    const logError = vi.fn<(message: string, fields: Record<string, unknown>) => void>();

    const res = await delegateDynamicRouteFetch({
      request: new Request("http://localhost/ping"),
      env: { LOADER: loader, ASSETS: assetsReturning("export default {}") },
      routeId: "ping",
      bindings: ["MISSING"],
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
