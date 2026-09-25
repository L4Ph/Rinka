import { describe, expect, it } from "vite-plus/test";
import { assertDynamicRouteAllowed, findDynamicRouteViolations } from "./denylist";

describe("assertDynamicRouteAllowed", () => {
  it("allows a normal route", () => {
    expect(() => assertDynamicRouteAllowed("export const r = 1;")).not.toThrow();
  });

  it("rejects WebSocket upgrade handlers", () => {
    const source = `
      app.get("/ws", async (c) => {
        if (c.req.header("Upgrade") !== "websocket") return c.text("nope", 426);
        return c.text("ok");
      });
    `;
    expect(() => assertDynamicRouteAllowed(source)).toThrow(/WebSocket/);
  });

  it("rejects Durable Object raw request forwarding", () => {
    const source = `const res = await env.MY_DO.fetch(c.req.raw);`;
    expect(() => assertDynamicRouteAllowed(source)).toThrow(/raw request forwarding/);
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
    expect(findDynamicRouteViolations(source)).toContainEqual({ kind: "websocket" });
  });

  it("does not flag websocket mentioned only in comments or logs", () => {
    const source = `
      // upgrade !== "websocket"
      console.log("websocket protocol mentioned in logs");
      export const route = new Hono().get("/", (c) => c.text("ok"));
    `;
    expect(findDynamicRouteViolations(source)).not.toContainEqual({ kind: "websocket" });
  });

  it("flags wasm imports including Vite ?init suffix", () => {
    const source = `import init from "./m.wasm?init";`;
    expect(findDynamicRouteViolations(source)).toContainEqual({ kind: "wasm" });
  });

  it("does not flag .wasm in unrelated string literals", () => {
    const source = `const hint = 'load ./file.wasm" carefully';`;
    expect(findDynamicRouteViolations(source)).not.toContainEqual({ kind: "wasm" });
  });
});
