# rinka example — Pokédex

A Hono app on Cloudflare Workers that lists Pokémon from [PokéAPI](https://pokeapi.co/) with likes stored in KV. It demonstrates rinka's per-route Dynamic Worker delegation end to end.

## Structure

- `src/index.tsx` — host Hono app; wires routes, exports `AppType`, and exports the `Likes` `WorkerEntrypoint` loopback
- `src/routes/pokedex.tsx` — dynamic route (`/`) listing Pokémon (fetched from PokéAPI inside the isolate), paginated
- `src/routes/pokemon.tsx` — dynamic route (`/pokemon/:id` detail + `POST /pokemon/:id/like`)
- `src/routes/about.tsx` — inline route (`/about`) handled by the host worker
- `src/lib/pokeapi.ts` — PokéAPI client + types
- `src/lib/likes.ts` — the `LIKES` binding type the dynamic routes use

## What it demonstrates

- **Dynamic routes** — the Pokédex and detail pages run in their own Worker isolates, loaded via the `LOADER` Worker Loader binding. `rinkaVitePlugin` bundles each to `public/dynamic-routes/<id>.js`; the isolate fetches its code through `ASSETS`.
- **Loopback bindings** — the isolates reach KV only through `env.LIKES`, a `ctx.exports.Likes({ props })` stub. `Likes` runs in the host worker, where `LIKES_KV` lives. The isolate never holds the KV binding.
- **Workers Cache** — GET pages set `Cache-Control`, so the edge cache (`cache.enabled` in `wrangler.jsonc`) serves repeated views without running the worker. `POST /pokemon/:id/like` always runs.

## Data

Pokémon and sprites come from PokéAPI and its official-artwork sprites on GitHub. No API key required.

## Scripts

```bash
pnpm dev        # start the Vite dev server with Cloudflare Workers runtime
pnpm build      # typecheck and build
pnpm check      # typecheck only
pnpm deploy     # build and deploy with wrangler (set a real KV id first)
```

The `kv_namespaces` id in `wrangler.jsonc` is a placeholder; create a real one with `wrangler kv namespace create LIKES_KV` before deploying.
