import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { build, type Plugin } from "vite-plus";
import {
  type BindingPolicyMap,
  defaultBindingPolicies,
  resolveBindingPolicies,
} from "../binding-policy";
import { cloudflareShim } from "./cloudflare-shim";
import { assertDynamicRouteAllowed } from "./denylist";
import { formatDynamicManifestSource } from "./format-dynamic-manifest";
import { generateRouterInit } from "./generate-router-init";
import { defaultPathAliases, resolveModuleFile } from "./resolve-module";
import { scanDynamicRoutesInFile, type ScannedDynamicRoute } from "./scan-dynamic-routes";
import { assertProxyExportsExist } from "./validate-proxy-exports";
import { assertDeclaredBindingsCoverEnvAccess } from "./validate-route-bindings";

export type HibanaVitePluginOptions = {
  root: string;
  appEntry: string;
  appExport?: string;
  generateRouterInitFlag?: string;
  scanFile: string;
  routerInitOut: string;
  manifestOut: string;
  assetsDir: string;
  assetsBasePath?: string;
  entryDir?: string;
  pathAliases?: Record<string, string>;
  /**
   * Classification of every binding dynamic routes may declare, merged over
   * hibana's defaults (IMAGES forbidden). A declared binding without a policy
   * fails the build — Worker Loader envs only accept structured-clonable
   * values and Service Binding stubs, so each binding must state how it is
   * delivered (primitive / service / proxy / forbidden).
   */
  bindingPolicies?: BindingPolicyMap;
};

function writeIfChanged(path: string, content: string): boolean {
  let prev: string | null = null;
  try {
    prev = readFileSync(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  if (prev === content) return false;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  return true;
}

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

async function bundleDynamicRoute(
  route: ScannedDynamicRoute,
  options: Required<Pick<HibanaVitePluginOptions, "root" | "assetsDir" | "entryDir">>,
): Promise<void> {
  const entryFile = resolve(options.entryDir, `${route.id}.ts`);
  const moduleImportPath = relativeImport(dirname(entryFile), route.modulePath);
  writeFileSync(entryFile, buildRouteBundleSource(route.exportName, moduleImportPath));

  try {
    await build({
      configFile: false,
      root: options.root,
      plugins: [cloudflareShim],
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

function resolveOptions(options: HibanaVitePluginOptions) {
  const root = options.root;
  return {
    root,
    appEntry: options.appEntry,
    appExport: options.appExport,
    generateRouterInitFlag: options.generateRouterInitFlag,
    scanFile: resolve(root, options.scanFile),
    routerInitOut: resolve(root, options.routerInitOut),
    manifestOut: resolve(root, options.manifestOut),
    assetsDir: resolve(root, options.assetsDir),
    assetsBasePath: options.assetsBasePath ?? "/dynamic-routes",
    entryDir: resolve(root, options.entryDir ?? ".dynamic-route-entries"),
    pathAliases: options.pathAliases ?? defaultPathAliases(root),
    bindingPolicies: { ...defaultBindingPolicies, ...options.bindingPolicies },
  };
}

async function runHibanaCodegen(
  ctx: { info: (msg: string) => void },
  options: HibanaVitePluginOptions,
  cacheDevServer: boolean,
): Promise<void> {
  const resolved = resolveOptions(options);

  const routerInit = await generateRouterInit({
    root: resolved.root,
    appEntry: resolved.appEntry,
    appExport: resolved.appExport,
    generateRouterInitFlag: resolved.generateRouterInitFlag,
    cacheDevServer,
  });
  if (writeIfChanged(resolved.routerInitOut, routerInit)) {
    ctx.info("[hibana] regenerated router init");
  }

  const scanned = scanDynamicRoutesInFile(resolved.scanFile, resolved.root, resolved.pathAliases);
  const manifestRoutes = scanned.map((route) => {
    const source = readFileSync(route.modulePath, "utf8");
    assertDeclaredBindingsCoverEnvAccess(source, route.bindings);
    assertDynamicRouteAllowed(source, route.bindings, resolved.bindingPolicies);
    // assertDynamicRouteAllowed already rejected unregistered/forbidden bindings.
    const { resolved: resolvedBindings } = resolveBindingPolicies(
      route.bindings,
      resolved.bindingPolicies,
    );
    return { ...route, resolvedBindings };
  });

  assertProxyExportsExist({
    entrySource: readFileSync(resolve(resolved.root, resolved.appEntry), "utf8"),
    entryPath: resolved.appEntry,
    routes: manifestRoutes,
  });

  const manifestSource = formatDynamicManifestSource(manifestRoutes, resolved.assetsBasePath);
  if (writeIfChanged(resolved.manifestOut, manifestSource)) {
    ctx.info("[hibana] regenerated dynamic route manifest");
  }

  mkdirSync(resolved.assetsDir, { recursive: true });
  mkdirSync(resolved.entryDir, { recursive: true });
  for (const route of manifestRoutes) {
    await bundleDynamicRoute(route, {
      root: resolved.root,
      assetsDir: resolved.assetsDir,
      entryDir: resolved.entryDir,
    });
  }
}

export function hibanaVitePlugin(options: HibanaVitePluginOptions): Plugin {
  return {
    name: "hibana",
    buildStart() {
      return runHibanaCodegen(this, options, false);
    },
    configureServer() {
      return runHibanaCodegen(this, options, true);
    },
  };
}

export { resolveModuleFile };
