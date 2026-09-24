import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { scanDynamicRoutes, scanDynamicRoutesFromEntry } from "./scan-dynamic-routes";

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
    expect(routes[0]?.loopbacks).toEqual([]);
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

  it("reads loopback declarations (export names) and ignores props", () => {
    const source = `
      import { healthRoute } from "./health-route";
      import { dynamic } from "rinka";
      export const v1 = new Hono().route("/health", dynamic(healthRoute, {
        id: "health",
        bindings: [],
        loopbacks: { STORAGE: { export: "MyKv", props: { prefix: "t1" } } },
      }));
    `;
    const routes = scanDynamicRoutes(source, backendV1Index, backendV1Dir);
    expect(routes[0]?.loopbacks).toEqual([{ name: "STORAGE", export: "MyKv" }]);
  });

  it("does not count a dynamic() mention in a comment", () => {
    const source = `
      // wrap a route with dynamic() to run it in its own isolate
      import { healthRoute } from "./health-route";
      import { dynamic } from "rinka";
      export const v1 = new Hono().route("/health", dynamic(healthRoute, { id: "health", bindings: [] }));
    `;
    const routes = scanDynamicRoutes(source, backendV1Index, backendV1Dir);
    expect(routes).toHaveLength(1);
  });

  it("ignores a textual dynamic( when the file does not import dynamic", () => {
    const source = `export const thing = registry.dynamic(1);`;
    expect(scanDynamicRoutes(source, backendV1Index, backendV1Dir)).toEqual([]);
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

describe("scanDynamicRoutesFromEntry", () => {
  it("finds dynamic() call sites in the entry and its local imports", () => {
    const dir = mkdtempSync(join(tmpdir(), "rinka-scan-"));
    writeFileSync(join(dir, "route.ts"), "export const route = 1;\n");
    writeFileSync(
      join(dir, "routes.ts"),
      `import { route } from "./route";\nimport { dynamic } from "rinka";\nexport const r = dynamic(route, { id: "health", bindings: [] });\n`,
    );
    writeFileSync(join(dir, "app.ts"), `import { r } from "./routes";\nexport const app = r;\n`);

    const routes = scanDynamicRoutesFromEntry(join(dir, "app.ts"), {});
    expect(routes.map((route) => route.id)).toEqual(["health"]);
    expect(routes[0]?.modulePath).toBe(join(dir, "route.ts"));
  });
});
