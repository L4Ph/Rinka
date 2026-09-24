# rinka example

A minimal Hono app on Cloudflare Workers using `rinka` for opt-in per-route Dynamic Worker delegation.

## Structure

- `src/index.tsx` — host Hono app; wires routes and exports `AppType`
- `src/routes/index.tsx` — dynamic route (`/`) listing ramen shops from the Ramen API
- `src/routes/shops.tsx` — inline route (`/shops/:id`) showing shop details and photos
- `src/routes/photos.tsx` — dynamic route (`/shops/:id/photos/:index`) showing a single photo
- `src/routes/prefectures.tsx` — dynamic route (`/prefectures/:prefecture/shops`) listing shops by prefecture
- `src/routes/about.tsx` — inline route (`/about`) handled by the host worker

## Scripts

```bash
pnpm dev        # start the Vite dev server with Cloudflare Workers runtime
pnpm build      # typecheck and build
pnpm check      # typecheck only
pnpm deploy     # build and deploy with wrangler
```

## What it demonstrates

Routes wrapped with `dynamic()` run in separate Worker isolates loaded via the `LOADER` Worker Loader binding — `rinkaVitePlugin` bundles each to `public/dynamic-routes/<id>.js` and the isolate fetches its code through the `ASSETS` binding. Inline routes (`/shops/:id`, `/about`) are normal Hono routes in the host worker.
