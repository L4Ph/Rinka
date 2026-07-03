import { describe, expect, it } from "vite-plus/test";
import { assertDeclaredBindingsCoverEnvAccess } from "./validate-route-bindings";

describe("assertDeclaredBindingsCoverEnvAccess", () => {
  it("requires explicit bindings when c.env is referenced", () => {
    const source = `export const route = new Hono().get("/", (c) => c.env.RATE_LIMIT_KV);`;
    expect(() => assertDeclaredBindingsCoverEnvAccess(source, [])).toThrow(/bindings: \[\]/);
  });

  it("requires declared bindings to cover all c.env references", () => {
    const source = `
      export const route = new Hono().get("/", async (c) => {
        await consumeRateLimit(c.env.RATE_LIMIT_KV, { key: "x" });
        return c.text(String(c.env.CONTACT_SLACK_WEBHOOK_URL));
      });
    `;
    expect(() => assertDeclaredBindingsCoverEnvAccess(source, ["RATE_LIMIT_KV"])).toThrow(
      /CONTACT_SLACK_WEBHOOK_URL/,
    );
  });

  it("passes when declared bindings cover c.env usage", () => {
    const source = `export const route = new Hono().get("/", (c) => c.env.RATE_LIMIT_KV);`;
    expect(() => assertDeclaredBindingsCoverEnvAccess(source, ["RATE_LIMIT_KV"])).not.toThrow();
  });

  it("detects destructuring from context env", () => {
    const source = `
      export const route = new Hono().get("/", (c) => {
        const { KV } = c.env;
        return c.text(String(KV));
      });
    `;
    expect(() => assertDeclaredBindingsCoverEnvAccess(source, [])).toThrow(/bindings: \[\]/);
    expect(() => assertDeclaredBindingsCoverEnvAccess(source, ["KV"])).not.toThrow();
  });

  it("detects bracket access on context env", () => {
    const source = `
      export const route = new Hono().get("/", (c) => c.env["KV"]);
    `;
    expect(() => assertDeclaredBindingsCoverEnvAccess(source, [])).toThrow(/bindings: \[\]/);
  });

  it("detects env aliases assigned from context env", () => {
    const source = `
      export const route = new Hono().get("/", (c) => {
        const env = c.env;
        return c.text(String(env.KV));
      });
    `;
    expect(() => assertDeclaredBindingsCoverEnvAccess(source, [])).toThrow(/bindings: \[\]/);
    expect(() => assertDeclaredBindingsCoverEnvAccess(source, ["KV"])).not.toThrow();
  });

  it("detects env access when the context parameter is not named c", () => {
    const source = `
      export const route = new Hono().get("/", (ctx) => ctx.env.RATE_LIMIT_KV);
    `;
    expect(() => assertDeclaredBindingsCoverEnvAccess(source, [])).toThrow(/bindings: \[\]/);
  });

  it("requires declared bindings when context env is passed to a helper", () => {
    const source = `
      export const route = new Hono().get("/", (c) => helper(c.env));
    `;
    expect(() => assertDeclaredBindingsCoverEnvAccess(source, [])).toThrow(/passes context env/);
    expect(() => assertDeclaredBindingsCoverEnvAccess(source, ["RATE_LIMIT_KV"])).not.toThrow();
  });
});
