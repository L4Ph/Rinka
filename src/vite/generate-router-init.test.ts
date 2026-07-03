import { resolve } from "node:path";
import { createServer } from "vite-plus";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("vite-plus", async (importOriginal) => {
  const mod = await importOriginal<typeof import("vite-plus")>();
  return {
    ...mod,
    createServer: vi.fn<typeof mod.createServer>(mod.createServer),
  };
});

import { clearGenerateRouterInitCacheForTests, generateRouterInit } from "./generate-router-init";

describe("generateRouterInit", () => {
  const root = resolve(import.meta.dirname, "../../tests/fixtures/router-init-app");
  const options = {
    root,
    appEntry: "src/index.ts",
    appExport: "app",
  } as const;

  afterEach(() => {
    clearGenerateRouterInitCacheForTests();
    vi.mocked(createServer).mockClear();
  });

  it("reuses cached router init when the entry file is unchanged", async () => {
    await generateRouterInit(options);

    vi.mocked(createServer).mockClear();
    const cached = await generateRouterInit(options);

    expect(cached).toContain('"/v1/health"');
    expect(createServer).not.toHaveBeenCalled();
  });

  it("does not cache the dev server when cacheDevServer is false", async () => {
    await generateRouterInit({ ...options, cacheDevServer: false });

    vi.mocked(createServer).mockClear();
    await generateRouterInit({ ...options, cacheDevServer: false });

    expect(createServer).toHaveBeenCalledOnce();
  });
});
