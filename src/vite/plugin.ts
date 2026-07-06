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
import { formatAppTypeSource } from "./format-app-type";
import { formatDispatchSource } from "./format-dispatch";
import { formatDynamicManifestSource, formatDynamicModulesSource } from "./format-dynamic-manifest";
import { honoTinyAlias } from "./hono-tiny-alias";
import { defaultPathAliases, resolveModuleFile } from "./resolve-module";
import { scanRouteRegistrationsInFile, type ScannedRoute } from "./scan-route-registrations";
import { assertProxyExportsExist } from "./validate-proxy-exports";
import { assertDeclaredBindingsCoverEnvAccess } from "./validate-route-bindings";

export type RinkaVitePluginOptions = {
  root: string;
  appEntry: string;
  appExport?: string;
  scanFile: string;
  manifestOut: string;
  assetsDir: string;
  assetsBasePath?: string;
  entryDir?: string;
  pathAliases?: Record<string, string>;
  /**
   * Classification of every binding dynamic routes may declare, merged over
   * rinka's defaults (IMAGES forbidden). A declared binding without a policy
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

/** Bundles one dynamic route into an isolate Worker module and returns its code. */
async function bundleDynamicRoute(
  route: Pick<ScannedRoute, "id" | "exportName" | "modulePath">,
  options: Required<Pick<RinkaVitePluginOptions, "root" | "assetsDir" | "entryDir">>,
): Promise<string> {
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

  return readFileSync(resolve(options.assetsDir, `${route.id}.js`), "utf8");
}

function resolveOptions(options: RinkaVitePluginOptions) {
  const root = options.root;
  return {
    root,
    appEntry: options.appEntry,
    appExport: options.appExport,
    scanFile: resolve(root, options.scanFile),
    manifestOut: resolve(root, options.manifestOut),
    assetsDir: resolve(root, options.assetsDir),
    assetsBasePath: options.assetsBasePath ?? "/dynamic-routes",
    entryDir: resolve(root, options.entryDir ?? ".dynamic-route-entries"),
    pathAliases: options.pathAliases ?? defaultPathAliases(root),
    bindingPolicies: { ...defaultBindingPolicies, ...options.bindingPolicies },
  };
}

async function runRinkaCodegen(
  ctx: { info: (msg: string) => void },
  options: RinkaVitePluginOptions,
): Promise<void> {
  const resolved = resolveOptions(options);
  const generatedDir = dirname(resolved.manifestOut);

  const routes = scanRouteRegistrationsInFile(
    resolved.scanFile,
    resolved.root,
    resolved.pathAliases,
  );
  const dynamicRoutes = routes.filter((route) => route.dynamic);

  const manifestRoutes = dynamicRoutes.map((route) => {
    const source = readFileSync(route.modulePath, "utf8");
    assertDeclaredBindingsCoverEnvAccess(source, route.bindings, route.modulePath);
    assertDynamicRouteAllowed(source, route.bindings, resolved.bindingPolicies, route.modulePath);
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

  mkdirSync(resolved.assetsDir, { recursive: true });
  mkdirSync(resolved.entryDir, { recursive: true });

  // Bundle each dynamic route and embed its code as a host string constant, so
  // the host hands it straight to Worker Loader (no runtime asset fetch).
  const modules: Record<string, string> = {};
  for (const route of manifestRoutes) {
    modules[route.id] = await bundleDynamicRoute(route, {
      root: resolved.root,
      assetsDir: resolved.assetsDir,
      entryDir: resolved.entryDir,
    });
  }

  const importPathFor = (route: ScannedRoute) => relativeImport(generatedDir, route.modulePath);

  // The manifest imports the modules file, so write the modules first.
  const modulesOut = resolve(generatedDir, "dynamic-modules.ts");
  if (writeIfChanged(modulesOut, formatDynamicModulesSource(modules))) {
    ctx.info("[rinka] regenerated embedded dynamic route modules");
  }
  if (writeIfChanged(resolved.manifestOut, formatDynamicManifestSource(manifestRoutes))) {
    ctx.info("[rinka] regenerated dynamic route manifest");
  }

  const appTypeSource = formatAppTypeSource(
    routes.map((route) => ({
      mount: route.mount,
      exportName: route.exportName,
      importPath: importPathFor(route),
    })),
  );
  if (writeIfChanged(resolve(generatedDir, "app-type.ts"), appTypeSource)) {
    ctx.info("[rinka] regenerated AppType");
  }

  const dispatchSource = formatDispatchSource(
    routes.map((route) => ({
      mount: route.mount,
      exportName: route.exportName,
      importPath: importPathFor(route),
      id: route.id,
      dynamic: route.dynamic,
      bindings: route.bindings,
    })),
  );
  if (writeIfChanged(resolve(generatedDir, "dispatch.ts"), dispatchSource)) {
    ctx.info("[rinka] regenerated dispatch");
  }
}

export function rinkaVitePlugin(options: RinkaVitePluginOptions): Plugin {
  return {
    name: "rinka",
    buildStart() {
      return runRinkaCodegen(this, options);
    },
    configureServer() {
      return runRinkaCodegen(this, options);
    },
  };
}

export { resolveModuleFile };
