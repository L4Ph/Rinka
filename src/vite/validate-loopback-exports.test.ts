import { describe, expect, it } from "vite-plus/test";
import { assertLoopbackExportsExist } from "./validate-loopback-exports";

describe("assertLoopbackExportsExist", () => {
  it("passes when every loopback export exists in the entry module", () => {
    expect(() =>
      assertLoopbackExportsExist({
        entrySource: `export class MyKv {}`,
        entryPath: "src/app.ts",
        routes: [{ id: "x", loopbacks: [{ name: "STORAGE", export: "MyKv" }] }],
      }),
    ).not.toThrow();
  });

  it("passes when a route declares no loopbacks", () => {
    expect(() =>
      assertLoopbackExportsExist({
        entrySource: ``,
        entryPath: "src/app.ts",
        routes: [{ id: "x", loopbacks: [] }],
      }),
    ).not.toThrow();
  });

  it("fails naming the route, binding, and missing export", () => {
    expect(() =>
      assertLoopbackExportsExist({
        entrySource: `export class Other {}`,
        entryPath: "src/app.ts",
        routes: [{ id: "x", loopbacks: [{ name: "STORAGE", export: "MyKv" }] }],
      }),
    ).toThrow(/route "x" binding "STORAGE" needs export "MyKv"/);
  });
});
