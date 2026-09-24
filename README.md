# rinka

> **rinka** (燐火) — Japanese for "will-o'-the-wisp" / "phosphorescent flame". Each route is a small flame that lights up on demand inside its own isolated Worker.

Opt-in, per-route [Dynamic Worker](https://developers.cloudflare.com/dynamic-workers/) (Worker Loader) delegation for [Hono](https://hono.dev/) apps on Cloudflare Workers.

Keep a single Hono `app` (and a single `AppType` for RPC inference), and move individual routes into sandboxed, dynamically-loaded Worker isolates by wrapping their mount with `dynamic()`. A Vite plugin scans the `dynamic()` calls, bundles each route as a separate asset, and fetches the code at runtime. There is no manifest and no generated code — `AppType` is just `typeof app`.

> **Status: experimental.** Verified end-to-end on Miniflare (dev). Worker Loader itself is a Cloudflare open beta.

## Architecture

```
Request
  → host middleware (CORS / auth / logging — unchanged)
  → Hono router
  → dynamic route?  → LOADER.get(id@buildId) → ASSETS.fetch(route.js) → isolate runs it
  → inline route    → normal handler
```

- **`rinka`** — runtime: `dynamic()` wrapper and `resolveLoaderEnv()`. No `cloudflare:workers` import; safe to load anywhere.
- **`rinka/vite`** — the build plugin: AST scan of `dynamic()` calls in the app entry, per-route bundling into assets, and build-time validation of bindings and loopback exports.

### The binding model

Worker Loader serializes the dynamic Worker's `env`. Only two kinds of value survive, and rinka supports exactly those:

| declaration                       | delivery                                                                                 |
| --------------------------------- | ---------------------------------------------------------------------------------------- |
| `bindings: ["NAME", ...]`         | copied from the host env as-is (structured-clonable value, or a Service Binding stub)    |
| `loopbacks: { NAME: { export } }` | a derived stub of a host-exported `WorkerEntrypoint`, via `ctx.exports[export]({props})` |

Platform bindings (KV / R2 / D1 / Queues / AI / ...) are **not** structured-clonable. To give a dynamic route one, wrap the resource in a `WorkerEntrypoint` class, export it from the host entry, and declare it as a loopback — the [official pattern](https://developers.cloudflare.com/dynamic-workers/usage/bindings/). rinka does not ship typed proxies for these; the class is yours, so you expose only the methods you want.

## Quickstart

### 1. wrangler.jsonc

```jsonc
{
  "worker_loaders": [{ "binding": "LOADER" }],
  "assets": { "directory": "./public", "binding": "ASSETS", "run_worker_first": true },
  // Required for loopback bindings (ctx.exports):
  "compatibility_flags": ["enable_ctx_exports"],
}
```

### 2. vite.config.ts

```ts
import { rinkaVitePlugin } from "rinka/vite";

rinkaVitePlugin({
  root: __dirname,
  appEntry: "src/index.ts",
  assetsDir: "public/dynamic-routes",
});
```

The plugin scans `appEntry` (and the local modules it imports) for `dynamic()` calls, bundles each route into `assetsDir`, and injects a build id so changed code loads a fresh isolate. `assetsBasePath` (default `/dynamic-routes`) must match where `assetsDir` is served.

### 3. Export loopback classes (only if you need a platform binding)

```ts
import { WorkerEntrypoint } from "cloudflare:workers";

export class MyKv extends WorkerEntrypoint<Env, { prefix: string }> {
  async get(key: string) {
    return this.env.MY_KV.get(`${this.ctx.props.prefix}:${key}`);
  }
}
```

### 4. Wrap routes

```ts
import { Hono } from "hono";
import { dynamic } from "rinka";
import { apiRoute } from "./routes/api";
import { aboutRoute } from "./routes/about";

const app = new Hono<{ Bindings: Env }>()
  .route(
    "/api",
    dynamic(apiRoute, {
      id: "api",
      bindings: ["APP_URL"],
      loopbacks: { STORAGE: { export: "MyKv", props: { prefix: "t1" } } },
    }),
  )
  .route("/about", aboutRoute);

export default app;
export type AppType = typeof app; // Hono RPC — no codegen
```

`bindings` is typed as keys of the route's `Bindings`, and a build-time AST pass verifies the declared list covers every `c.env.*` access in the route module. A loopback's `export` is verified to exist in the entry module.

## Examples

- [`example/`](./example) — a Hono app on Cloudflare Workers with dynamic routes (`/`, `/shops/:id/photos/:index`, `/prefectures/:prefecture/shops`) and inline routes (`/shops/:id`, `/about`). Run `pnpm install` from the repo root, then `pnpm --filter example dev`.
