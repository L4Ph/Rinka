import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { createServer, type ViteDevServer } from "vite-plus";
import { cloudflareShim } from "./cloudflare-shim";
import { formatRouterInitSource } from "./format-router-init";

export type GenerateRouterInitOptions = {
  root: string;
  appEntry: string;
  appExport?: string;
  generateRouterInitFlag?: string;
  /** Keep the SSR dev server alive between calls (dev only). Must be false during build. */
  cacheDevServer?: boolean;
};

type RouterInitCacheEntry = {
  fingerprint: string;
  server: ViteDevServer;
  routerInitSource: string;
};

const routerInitCache = new Map<string, RouterInitCacheEntry>();

export function clearGenerateRouterInitCacheForTests(): void {
  for (const entry of routerInitCache.values()) {
    void entry.server.close();
  }
  routerInitCache.clear();
}

function entryFingerprint(entryPath: string): string {
  const stat = statSync(entryPath);
  const content = readFileSync(entryPath);
  return createHash("sha256").update(content).update(String(stat.mtimeMs)).digest("hex");
}

async function loadRouterInitSource(
  server: ViteDevServer,
  entry: string,
  appExport: string,
): Promise<string> {
  const mod = (await server.ssrLoadModule(entry)) as Record<
    string,
    { routes: { path: string }[] } | undefined
  >;
  const app = mod[appExport];
  if (!app) {
    throw new Error(`${entry} must named-export \`${appExport}\``);
  }

  const paths = app.routes.map((route) => route.path);
  return formatRouterInitSource(paths);
}

export async function generateRouterInit(options: GenerateRouterInitOptions): Promise<string> {
  const {
    root,
    appEntry,
    appExport = "app",
    generateRouterInitFlag = "__GENERATE_ROUTER_INIT__",
    cacheDevServer = true,
  } = options;
  const entry = resolve(root, appEntry);
  const fingerprint = entryFingerprint(entry);
  const cached = cacheDevServer ? routerInitCache.get(entry) : undefined;
  if (cached?.fingerprint === fingerprint) {
    return cached.routerInitSource;
  }

  if (cached) {
    await cached.server.close();
    routerInitCache.delete(entry);
  }

  const server = await createServer({
    configFile: false,
    root,
    plugins: [cloudflareShim],
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "warn",
    define: {
      [generateRouterInitFlag]: JSON.stringify(true),
    },
  });

  try {
    const routerInitSource = await loadRouterInitSource(server, entry, appExport);
    if (cacheDevServer) {
      routerInitCache.set(entry, { fingerprint, server, routerInitSource });
    } else {
      await server.close();
    }
    return routerInitSource;
  } catch (error) {
    await server.close();
    throw error;
  }
}
