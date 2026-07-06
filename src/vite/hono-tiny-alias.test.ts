import { describe, expect, it, vi } from "vite-plus/test";
import { honoTinyAlias } from "./hono-tiny-alias";

type ResolveIdHook = (
  this: { resolve: (source: string, importer?: string, options?: unknown) => unknown },
  source: string,
  importer: string | undefined,
  options: Record<string, unknown>,
) => Promise<string | null>;

const resolveId = honoTinyAlias.resolveId as unknown as ResolveIdHook;

describe("honoTinyAlias", () => {
  it("redirects the bare `hono` entry to `hono/tiny`", async () => {
    const resolve = vi.fn(async () => ({ id: "/abs/hono/dist/tiny.js" }));
    const result = await resolveId.call({ resolve }, "hono", "/route.ts", {});

    expect(result).toBe("/abs/hono/dist/tiny.js");
    expect(resolve).toHaveBeenCalledWith(
      "hono/tiny",
      "/route.ts",
      expect.objectContaining({ skipSelf: true }),
    );
  });

  it("leaves hono subpaths and other modules untouched", async () => {
    const resolve = vi.fn();

    expect(await resolveId.call({ resolve }, "hono/jsx", "/route.ts", {})).toBeNull();
    expect(await resolveId.call({ resolve }, "hono/jsx-renderer", "/route.ts", {})).toBeNull();
    expect(await resolveId.call({ resolve }, "some-other-pkg", "/route.ts", {})).toBeNull();
    expect(resolve).not.toHaveBeenCalled();
  });
});
