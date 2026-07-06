import type { Plugin } from "vite-plus";

/**
 * Redirects the bare `hono` entry to `hono/tiny` inside dynamic-route (isolate)
 * bundles, so each dynamically-loaded Worker uses Hono's PatternRouter preset —
 * the smallest bundle, ideal for on-demand isolates that serve only a handful
 * of routes. Only the main `hono` entry differs by preset; subpaths such as
 * `hono/jsx` or `hono/cors` are left untouched, and the type surface is
 * identical across presets so RPC inference is unaffected. This plugin runs
 * only in the isolate bundle pipeline, so the host build keeps whatever router
 * it chose.
 */
export const honoTinyAlias: Plugin = {
  name: "rinka:hono-tiny",
  enforce: "pre",
  async resolveId(source, importer, options) {
    if (source !== "hono") return null;
    const resolution = await this.resolve("hono/tiny", importer, {
      ...options,
      skipSelf: true,
    });
    return resolution?.id ?? null;
  },
};
