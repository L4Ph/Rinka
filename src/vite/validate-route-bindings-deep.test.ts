import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import {
  assertDeclaredBindingsCoverEnvAccessDeep,
  collectEnvAccessDeep,
} from "./validate-route-bindings";

const routeFile = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../tests/fixtures/deep-env/route.ts",
);

describe("collectEnvAccessDeep", () => {
  it("finds env bindings used by imported middleware, not just the route module", () => {
    const { accessed } = collectEnvAccessDeep(routeFile);
    // The route module touches no env; the imported middleware reads SECRET.
    expect([...accessed]).toContain("SECRET");
  });
});

describe("assertDeclaredBindingsCoverEnvAccessDeep", () => {
  it("throws when a binding used only by imported middleware is undeclared", () => {
    expect(() => assertDeclaredBindingsCoverEnvAccessDeep(routeFile, [])).toThrow(/SECRET/);
  });

  it("passes when the middleware's binding is declared", () => {
    expect(() => assertDeclaredBindingsCoverEnvAccessDeep(routeFile, ["SECRET"])).not.toThrow();
  });
});
