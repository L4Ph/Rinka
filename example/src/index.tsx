import { WorkerEntrypoint } from "cloudflare:workers";
import { Hono } from "hono";
import { dynamic } from "rinka";
import { likeKey } from "./lib/likes";
import { aboutRoute } from "./routes/about";
import { pokedexRoute } from "./routes/pokedex";
import { pokemonRoute } from "./routes/pokemon";

// Host gateway: plain Hono. Dynamic routes run in their own Worker isolate and
// reach KV only through the `Likes` loopback below — the isolate never holds the
// KV binding itself.
const app = new Hono<{ Bindings: CloudflareBindings }>()
  .route(
    "/",
    dynamic(pokedexRoute, {
      id: "pokedex",
      bindings: [],
      loopbacks: { LIKES: { export: "Likes" } },
    }),
  )
  .route(
    "/pokemon",
    dynamic(pokemonRoute, {
      id: "pokemon",
      bindings: [],
      loopbacks: { LIKES: { export: "Likes" } },
    }),
  )
  .route("/about", aboutRoute);

export default app;

export type AppType = typeof app;

/**
 * Loopback binding exposed to the dynamic routes via `ctx.exports.Likes`. Each
 * call is an RPC from the isolate back into this host Worker, where the KV
 * namespace is available. Exported as a top-level `WorkerEntrypoint`.
 */
export class Likes extends WorkerEntrypoint<CloudflareBindings> {
  async count(id: string): Promise<number> {
    return Number((await this.env.LIKES_KV.get(likeKey(id))) ?? 0);
  }

  async counts(ids: string[]): Promise<Record<string, number>> {
    if (ids.length === 0) return {};
    const stored = await this.env.LIKES_KV.get(ids.map(likeKey));
    const out: Record<string, number> = {};
    for (const id of ids) out[id] = Number(stored.get(likeKey(id)) ?? 0);
    return out;
  }

  async like(id: string): Promise<number> {
    // ponytail: read-modify-write; KV has no atomic increment. Fine for a demo.
    const next = (await this.count(id)) + 1;
    await this.env.LIKES_KV.put(likeKey(id), String(next));
    return next;
  }
}
