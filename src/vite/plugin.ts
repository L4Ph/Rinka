import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { build, type Plugin } from "vite-plus";
import { cloudflareShim } from "./cloudflare-shim";
import { assertDynamicRouteAllowed } from "./denylist";
import { honoTinyAlias } from "./hono-tiny-alias";
import { defaultPathAliases } from "./resolve-module";
import { scanDynamicRoutesInFile, type ScannedDynamicRoute } from "./scan-dynamic-routes";
import { assertLoopbackExportsExist } from "./validate-loopback-exports";
import { assertDeclaredBindingsCoverEnvAccessDeep } from "./validate-route-bindings";

export type RinkaVitePluginOptions = {
  root: string;
  /**
   * Host entry module. rinka scans it (and the local modules it imports) for
   * `dynamic()` calls to find the routes to bundle.
   */
  appEntry: string;
  /** Directory the bundled route modules are written to (served as static assets). */
  assetsDir: string;
  /** URL path the assets are served at; must match the assets binding root. Default `/dynamic-routes`. */
  assetsBasePath?: string;
  /** Scratch directory for per-route bundle entry shims. Default `.dynamic-route-entries`. */
  entryDir?: string;
  pathAliases?: Record<string, string>;
};

function buildRouteBundleSource(exportName: string, moduleImportPath: string): string {
  return `import { ${exportName} } from ${JSON.stringify(moduleImportPath)};
export default {
  fetch(request, env, ctx) {
    return ${exportName}.fetch(request, env, ctx);
  },
};
`;
}

function relativeImport(fromDir: string, modulePath: string): string {
  const rel = relative(fromDir, modulePath.replace(/\.(tsx?|mts|jsx?|mjs)$/, ""));
  return rel.startsWith(".") ? rel : `./${rel}`;
}

/** Bundles one dynamic route into an isolate Worker module written to `assetsDir`. */
async function bundleDynamicRoute(
  route: Pick<ScannedDynamicRoute, "id" | "exportName" | "modulePath">,
  options: Required<Pick<RinkaVitePluginOptions, "root" | "assetsDir" | "entryDir">>,
): Promise<void> {
  const entryFile = resolve(options.entryDir, `${route.id}.ts`);
  const moduleImportPath = relativeImport(dirname(entryFile), route.modulePath);
  writeFileSync(entryFile, buildRouteBundleSource(route.exportName, moduleImportPath));

  try {
    await build({
      configFile: false,
      root: options.root,
      plugins: [cloudflareShim, honoTinyAlias],
      publicDir: false,
      logLevel: "silent",
      build: {
        outDir: options.assetsDir,
        emptyOutDir: false,
        lib: {
          entry: entryFile,
          formats: ["es"],
          fileName: () => `${route.id}.js`,
        },
        rollupOptions: {
          external: ["cloudflare:workers"],
        },
      },
    });
  } catch (err) {
    throw new Error(`Failed to bundle dynamic route ${route.id} (${entryFile})`, { cause: err });
  }
}

function resolveOptions(options: RinkaVitePluginOptions) {
  const root = options.root;
  return {
    root,
    appEntry: resolve(root, options.appEntry),
    assetsDir: resolve(root, options.assetsDir),
    assetsBasePath: options.assetsBasePath ?? "/dynamic-routes",
    entryDir: resolve(root, options.entryDir ?? ".dynamic-route-entries"),
    pathAliases: options.pathAliases ?? defaultPathAliases(root),
  };
}

async function runRinkaCodegen(
  ctx: { info: (msg: string) => void },
  options: RinkaVitePluginOptions,
): Promise<void> {
  const resolved = resolveOptions(options);

  const routes = scanDynamicRoutesInFile(resolved.appEntry, resolved.root, resolved.pathAliases);
  const duplicate = routes
    .map((route) => route.id)
    .find((id, index, ids) => ids.indexOf(id) !== index);
  if (duplicate) {
    throw new Error(`Duplicate dynamic route id "${duplicate}"`);
  }

  for (const route of routes) {
    const source = readFileSync(route.modulePath, "utf8");
    // Loopback names are delivered too (as ctx.exports stubs), so `c.env.X`
    // access to either kind of declaration is covered.
    const declared = [...route.bindings, ...route.loopbacks.map((loopback) => loopback.name)];
    assertDeclaredBindingsCoverEnvAccessDeep(route.modulePath, declared, resolved.pathAliases);
    assertDynamicRouteAllowed(source, route.modulePath);
  }

  assertLoopbackExportsExist({
    entrySource: readFileSync(resolved.appEntry, "utf8"),
    entryPath: resolved.appEntry,
    routes,
  });

  mkdirSync(resolved.assetsDir, { recursive: true });
  mkdirSync(resolved.entryDir, { recursive: true });

  for (const route of routes) {
    await bundleDynamicRoute(route, {
      root: resolved.root,
      assetsDir: resolved.assetsDir,
      entryDir: resolved.entryDir,
    });
    ctx.info(`[rinka] bundled dynamic route ${route.id}`);
  }
}

export function rinkaVitePlugin(options: RinkaVitePluginOptions): Plugin {
  const resolved = resolveOptions(options);
  // ponytail: time-based build id busts every isolate cache on each build. Swap
  // for a per-route content hash if cross-build isolate warm reuse matters.
  const buildId = Date.now().toString(36);

  return {
    name: "rinka",
    config() {
      return {
        define: {
          __RINKA_RUNTIME_CONFIG__: JSON.stringify({
            buildId,
            assetsBasePath: resolved.assetsBasePath,
          }),
        },
      };
    },
    buildStart() {
      return runRinkaCodegen(this, options);
    },
    configureServer() {
      return runRinkaCodegen(this, options);
    },
  };
}
