import { describe, expect, it } from "vite-plus/test";
import { formatAppTypeSource } from "./format-app-type";
import { formatDispatchSource } from "./format-dispatch";

describe("formatAppTypeSource", () => {
  it("composes every route into a typeof AppType aggregator", () => {
    const source = formatAppTypeSource([
      { mount: "/", exportName: "indexRoute", importPath: "../routes" },
      { mount: "/shops", exportName: "shopRoute", importPath: "../routes/shops" },
    ]);

    expect(source).toContain('import { indexRoute as r0 } from "../routes";');
    expect(source).toContain('import { shopRoute as r1 } from "../routes/shops";');
    expect(source).toContain('.route("/", r0)');
    expect(source).toContain('.route("/shops", r1)');
    expect(source).toContain("export type AppType = typeof app;");
  });
});

describe("formatDispatchSource", () => {
  it("mounts inline routes directly and wraps dynamic routes with dynamic()", () => {
    const source = formatDispatchSource([
      {
        mount: "/shops",
        exportName: "shopRoute",
        importPath: "../routes/shops",
        id: "shopDetail",
        dynamic: false,
        bindings: [],
      },
      {
        mount: "/shops",
        exportName: "photoRoute",
        importPath: "../routes/photos",
        id: "photos",
        dynamic: true,
        bindings: ["KV"],
      },
    ]);

    expect(source).toContain("export function registerDispatch(app: Hono<any, any, any>): void");
    // Inline mount, in order.
    expect(source).toContain('app.route("/shops", r0);');
    // Dynamic wrapped with id + bindings.
    expect(source).toContain(
      'app.route("/shops", dynamic(r1, { id: "photos", bindings: ["KV"] }));',
    );
    // Registration order is preserved (inline before dynamic at the same prefix).
    expect(source.indexOf("r0)")).toBeLessThan(source.indexOf("dynamic(r1"));
  });
});
