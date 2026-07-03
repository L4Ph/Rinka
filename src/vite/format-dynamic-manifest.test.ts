import { describe, expect, it } from "vite-plus/test";
import { formatDynamicManifestSource } from "./format-dynamic-manifest";

describe("formatDynamicManifestSource", () => {
  it("emits structured bindings so the runtime knows how to deliver each one", () => {
    const source = formatDynamicManifestSource([
      { id: "health", resolvedBindings: [] },
      {
        id: "loader-poc",
        resolvedBindings: [
          { name: "RATE_LIMIT_KV", mode: "proxy", proxyExport: "KvNamespaceProxy" },
          { name: "APP_URL", mode: "primitive" },
        ],
      },
      {
        id: "tenant",
        resolvedBindings: [
          {
            name: "TENANT_KV",
            mode: "proxy",
            proxyExport: "TenantKvProxy",
            props: { tenant: "a" },
          },
        ],
      },
    ]);

    // Identifier ids stay unquoted and objects use oxfmt spacing so `vp fmt`
    // does not rewrite the generated file after every codegen run.
    expect(source).toContain("  health: {");
    expect(source).toContain('  "loader-poc": {');
    expect(source).toContain('assetPath: "/dynamic-routes/loader-poc.js"');
    expect(source).toContain(
      '{ name: "RATE_LIMIT_KV", mode: "proxy", proxyExport: "KvNamespaceProxy" }',
    );
    expect(source).toContain('{ name: "APP_URL", mode: "primitive" }');
    // Nested props objects are emitted in oxfmt style too.
    expect(source).toContain(
      '{ name: "TENANT_KV", mode: "proxy", proxyExport: "TenantKvProxy", props: { tenant: "a" } }',
    );
    expect(source).toContain("registerDynamicRouteManifest(dynamicRouteManifest)");
  });
});
