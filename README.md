# rinka

> **rinka** (燐火) — Japanese for "will-o'-the-wisp" / "phosphorescent flame". Each route is a small flame that lights up on demand inside its own isolated Worker.

Opt-in, per-route [Dynamic Worker](https://developers.cloudflare.com/dynamic-workers/) (Worker Loader) delegation for [Hono](https://hono.dev/) apps on Cloudflare Workers.

Keep a single Hono `app` (and a single `AppType` for RPC inference), and move individual routes into sandboxed, dynamically-loaded Worker isolates by wrapping their mount with `dynamic()`. A Vite plugin scans the `dynamic()` calls, bundles each route as a separate asset, generates a manifest, and validates every binding the route declares at build time.

> **Status: experimental.** Extracted from a production monorepo where the model was verified end-to-end on Miniflare (dev) with KV and R2 proxies. Worker Loader itself is a Cloudflare open beta.

## Architecture

```
Request
  → host middleware (CORS / auth / logging — unchanged)
  → Hono router
  → dynamic route?  → LOADER.get(id) → isolate runs the route bundle from ASSETS
  → inline route    → normal handler
```

- **`rinka`** — runtime: `dynamic()` wrapper, manifest registry, `resolveLoaderEnv()`. No `cloudflare:workers` import; safe to load anywhere.
- **`rinka/proxies`** — typed `WorkerEntrypoint` proxy factories for platform bindings. workerd-only.
- **`rinka/vite`** — the build plugin: AST scan of `dynamic()` calls, per-route bundling into assets, manifest codegen, and binding-policy validation.

### The binding model

Worker Loader serializes the dynamic Worker's `env`. Only two kinds of values survive:

1. structured-clonable values (string vars, plain objects)
2. Service Binding stubs

Platform bindings (KV / R2 / D1 / Queues / AI / DO namespaces) are **not** structured-clonable. rinka therefore requires every binding a dynamic route declares to be classified with a `BindingPolicy`:

| mode        | delivery                                                                                           |
| ----------- | -------------------------------------------------------------------------------------------------- |
| `primitive` | copied as-is (structured clone)                                                                    |
| `service`   | Service Binding stub, passed as-is                                                                 |
| `proxy`     | derived stub of a host-exported `WorkerEntrypoint` proxy class, via `ctx.exports.Proxy({ props })` |
| `forbidden` | build error with a reason                                                                          |

Policies are resolved **at build time** and baked into the generated manifest, so what was validated is exactly what runs — there is no runtime registry to drift.

## Quickstart

### 1. wrangler.jsonc

```jsonc
{
  "worker_loaders": [{ "binding": "LOADER" }],
  "assets": { "directory": "./public", "binding": "ASSETS", "run_worker_first": true },
}
```

### 2. vite.config.ts

```ts
import { defineBindingPolicies } from "rinka";
import { rinkaVitePlugin } from "rinka/vite";

rinkaVitePlugin({
  root: __dirname,
  appEntry: "src/index.ts",
  scanFile: "src/routes/index.ts",
  manifestOut: "src/generated/dynamic-manifest.ts",
  assetsDir: "public/dynamic-routes",
  bindingPolicies: defineBindingPolicies<Env>({
    MY_KV: { mode: "proxy", proxyExport: "MyKvProxy" },
    MY_SERVICE: { mode: "service" },
    MY_SECRET: { mode: "primitive" },
  }),
});
```

`defineBindingPolicies<Env>` constrains the keys to your `Env`, so a typo'd binding name fails typecheck. A binding declared by a route without a registered policy fails the build.

### 3. Export proxy classes from the Worker entry

```ts
import { kvNamespaceProxy } from "rinka/proxies";

export class MyKvProxy extends kvNamespaceProxy<Env>("MY_KV") {}
```

### 4. Wrap routes

```ts
import { dynamic } from "rinka";

const app = new Hono<{ Bindings: Env }>()
  .route("/api", dynamic(apiRoute, { id: "api", bindings: ["MY_KV"] }))
  .route("/health", dynamic(healthRoute, { id: "health", bindings: [] }));
```

`bindings` is typed as keys of the route's `Bindings`, and an AST pass verifies the declared list covers every `c.env.*` access in the route module.

## Examples

- [`example/`](./example) — a Hono app on Cloudflare Workers with dynamic routes (`/`, `/shops/:id`, `/shops/:id/photos/:index`, `/prefectures/:prefecture/shops`) and one inline route (`/about`). Run `pnpm install` from the repo root, then `pnpm --filter example dev`.
