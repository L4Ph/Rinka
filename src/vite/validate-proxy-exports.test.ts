import { describe, expect, it } from "vite-plus/test";
import { assertProxyExportsExist } from "./validate-proxy-exports";

const ROUTES = [
  {
    id: "loader-poc",
    resolvedBindings: [
      { name: "RATE_LIMIT_KV", mode: "proxy", proxyExport: "KvNamespaceProxy" } as const,
      { name: "APP_URL", mode: "primitive" } as const,
    ],
  },
];

describe("assertProxyExportsExist", () => {
  it("accepts direct class exports and re-exports", () => {
    for (const entrySource of [
      "export class KvNamespaceProxy {}",
      'export { KvNamespaceProxy } from "./lib/dynamic-bindings";',
      'export { KvProxy as KvNamespaceProxy } from "./lib/dynamic-bindings";',
      "export const KvNamespaceProxy = makeProxy();",
    ]) {
      expect(() =>
        assertProxyExportsExist({ entrySource, entryPath: "src/index.ts", routes: ROUTES }),
      ).not.toThrow();
    }
  });

  it("fails the build when a proxy export is missing from the entry module", () => {
    expect(() =>
      assertProxyExportsExist({
        entrySource: 'export { EventHub } from "./lib/events/hub";',
        entryPath: "src/index.ts",
        routes: ROUTES,
      }),
    ).toThrow(/route "loader-poc" binding "RATE_LIMIT_KV" needs export "KvNamespaceProxy"/);
  });

  it("ignores primitive and service bindings", () => {
    expect(() =>
      assertProxyExportsExist({
        entrySource: "export default {};",
        entryPath: "src/index.ts",
        routes: [
          {
            id: "plain",
            resolvedBindings: [
              { name: "APP_URL", mode: "primitive" },
              { name: "RESIZE", mode: "service" },
            ],
          },
        ],
      }),
    ).not.toThrow();
  });
});
