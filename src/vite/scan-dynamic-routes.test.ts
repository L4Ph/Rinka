import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { scanDynamicRoutes } from "./scan-dynamic-routes";

const backendV1Dir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../tests/fixtures/scan-app/src/v1",
);
const backendV1Index = resolve(backendV1Dir, "index.ts");

describe("scanDynamicRoutes", () => {
  it("finds dynamic route registrations and resolves module paths", () => {
    const source = `
      import { healthRoute } from "./health-route";
      import { dynamic } from "rinka";
      export const v1 = new Hono().route("/health", dynamic(healthRoute, { id: "health", bindings: [] }));
    `;
    const routes = scanDynamicRoutes(source, backendV1Index, backendV1Dir);
    expect(routes).toHaveLength(1);
    expect(routes[0]?.id).toBe("health");
    expect(routes[0]?.bindings).toEqual([]);
    expect(routes[0]?.exportName).toBe("healthRoute");
    expect(routes[0]?.modulePath).toContain("health-route");
  });

  it("accepts options keys in any order", () => {
    const source = `
      import { healthRoute } from "./health-route";
      import { dynamic } from "rinka";
      export const v1 = new Hono().route(
        "/health",
        dynamic(healthRoute, { bindings: ["RATE_LIMIT_KV"], id: "health" }),
      );
    `;
    const routes = scanDynamicRoutes(source, backendV1Index, backendV1Dir);
    expect(routes[0]?.bindings).toEqual(["RATE_LIMIT_KV"]);
  });

  it("throws when dynamic calls are not fully parsed", () => {
    const source = `
      import { healthRoute } from "./health-route";
      import { dynamic } from "rinka";
      dynamic(healthRoute, { id: "health" });
    `;
    expect(() => scanDynamicRoutes(source, backendV1Index, backendV1Dir)).toThrow(
      /missing bindings/,
    );
  });
});
