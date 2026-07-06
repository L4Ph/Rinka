import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { scanRouteRegistrations } from "./scan-route-registrations";

const v1Dir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../tests/fixtures/scan-app/src/v1",
);
const v1Index = resolve(v1Dir, "index.ts");

describe("scanRouteRegistrations", () => {
  it("scans defineRoutes entries: mount, id, route import, dynamic, bindings", () => {
    const source = `
      import { defineRoutes } from "rinka";
      import { healthRoute } from "./health-route";
      export default defineRoutes([
        { mount: "/health", route: healthRoute, id: "health", dynamic: true, bindings: ["RATE_LIMIT_KV"] },
        { mount: "/about", route: healthRoute },
      ]);
    `;
    const routes = scanRouteRegistrations(source, v1Index, v1Dir);
    expect(routes).toHaveLength(2);
    expect(routes[0]).toMatchObject({
      mount: "/health",
      id: "health",
      exportName: "healthRoute",
      dynamic: true,
      bindings: ["RATE_LIMIT_KV"],
    });
    expect(routes[0]?.modulePath).toContain("health-route");
    // Inline route: dynamic defaults false, id derived from the mount.
    expect(routes[1]).toMatchObject({ mount: "/about", dynamic: false, id: "about", bindings: [] });
  });

  it("throws when a dynamic route is missing an id", () => {
    const source = `
      import { defineRoutes } from "rinka";
      import { healthRoute } from "./health-route";
      export default defineRoutes([{ mount: "/x", route: healthRoute, dynamic: true }]);
    `;
    expect(() => scanRouteRegistrations(source, v1Index, v1Dir)).toThrow(/missing "id"/);
  });

  it("throws on duplicate dynamic route ids", () => {
    const source = `
      import { defineRoutes } from "rinka";
      import { healthRoute } from "./health-route";
      export default defineRoutes([
        { mount: "/a", route: healthRoute, id: "dup", dynamic: true },
        { mount: "/b", route: healthRoute, id: "dup", dynamic: true },
      ]);
    `;
    expect(() => scanRouteRegistrations(source, v1Index, v1Dir)).toThrow(
      /Duplicate dynamic route id/,
    );
  });
});
