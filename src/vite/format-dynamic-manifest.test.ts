import { describe, expect, it } from "vite-plus/test";
import { formatDynamicManifestSource, formatDynamicModulesSource } from "./format-dynamic-manifest";

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
    // Module code is embedded in the host bundle (see dynamic-modules), not
    // fetched from ASSETS — the manifest carries only binding metadata.
    expect(source).not.toContain("assetPath");
    expect(source).toContain('import "./dynamic-modules"');
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

describe("formatDynamicModulesSource", () => {
  it("embeds each route's bundled code as a string and registers it", () => {
    const source = formatDynamicModulesSource({
      health: 'export default { fetch() { return new Response("ok"); } }',
      "loader-poc": "export default {}",
    });

    expect(source).toContain("  health:");
    expect(source).toContain('  "loader-poc":');
    // Code is embedded as a safely-escaped string literal.
    expect(source).toContain(
      JSON.stringify('export default { fetch() { return new Response("ok"); } }'),
    );
    expect(source).toContain("registerDynamicModules(dynamicModules)");
  });

  it("emits an empty registry when there are no dynamic routes", () => {
    const source = formatDynamicModulesSource({});
    expect(source).toContain("export const dynamicModules: Record<string, string> = {};");
  });
});
