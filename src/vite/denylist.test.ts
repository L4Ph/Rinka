import { describe, expect, it } from "vite-plus/test";
import { assertDynamicRouteAllowed, findDynamicRouteViolations } from "./denylist";

describe("assertDynamicRouteAllowed", () => {
  it("rejects forbidden bindings (IMAGES by default policy)", () => {
    expect(() => assertDynamicRouteAllowed("", ["IMAGES"])).toThrow(/IMAGES/);
  });

  it("rejects bindings without a registered policy", () => {
    // Platform bindings like KV are NOT structured-clonable; without an
    // explicit policy the build must fail instead of 500ing at runtime.
    expect(() => assertDynamicRouteAllowed("", ["RATE_LIMIT_KV"])).toThrow(
      /RATE_LIMIT_KV has no rinka binding policy/,
    );
  });

  it("allows bindings with primitive / service / proxy policies", () => {
    expect(() =>
      assertDynamicRouteAllowed("", ["APP_URL", "RESIZE", "RATE_LIMIT_KV"], {
        APP_URL: { mode: "primitive" },
        RESIZE: { mode: "service" },
        RATE_LIMIT_KV: { mode: "proxy", proxyExport: "KvNamespaceProxy" },
      }),
    ).not.toThrow();
  });

  it("treats an explicit policy map as exhaustive (defaults are merged by the plugin)", () => {
    expect(() =>
      assertDynamicRouteAllowed("", ["IMAGES"], {
        RATE_LIMIT_KV: { mode: "proxy", proxyExport: "KvNamespaceProxy" },
      }),
    ).toThrow(/IMAGES has no rinka binding policy/);
  });
});

describe("findDynamicRouteViolations", () => {
  it("flags WebSocket upgrade handlers", () => {
    const source = `
      app.get("/ws", async (c) => {
        if (c.req.header("Upgrade") !== "websocket") return c.text("nope", 426);
        return c.text("ok");
      });
    `;
    expect(findDynamicRouteViolations(source, [])).toContainEqual({ kind: "websocket" });
  });

  it("does not flag websocket mentioned only in comments or logs", () => {
    const source = `
      // upgrade !== "websocket"
      console.log("websocket protocol mentioned in logs");
      export const route = new Hono().get("/", (c) => c.text("ok"));
    `;
    expect(findDynamicRouteViolations(source, [])).not.toContainEqual({ kind: "websocket" });
  });

  it("flags wasm imports including Vite ?init suffix", () => {
    const source = `import init from "./m.wasm?init";`;
    expect(findDynamicRouteViolations(source, [])).toContainEqual({ kind: "wasm" });
  });

  it("does not flag .wasm in unrelated string literals", () => {
    const source = `const hint = 'load ./file.wasm" carefully';`;
    expect(findDynamicRouteViolations(source, [])).not.toContainEqual({ kind: "wasm" });
  });
});
