import { Hono } from "hono";
import { PokemonCard } from "../components/pokemon-card";
import type { LikesService } from "../lib/likes";
import { fetchPokedex } from "../lib/pokeapi";
import { renderer } from "../renderer";

// Runs inside its own Worker isolate. It fetches PokéAPI directly (isolate
// network) and reads like counts through the LIKES loopback binding.
type Bindings = { LIKES: LikesService };

const app = new Hono<{ Bindings: Bindings }>().use(renderer).get("/", async (c) => {
  const page = Math.max(1, Number(c.req.query("page")) || 1);
  const { items, hasNext } = await fetchPokedex(page);
  const likes = await c.env.LIKES.counts(items.map((item) => String(item.id)));

  // Workers Cache (wrangler `cache.enabled`): the host's edge cache stores this
  // response. Short max-age so like counts stay fresh; POSTs are never cached.
  c.header("Cache-Control", "public, max-age=30, stale-while-revalidate=60");
  return c.render(
    <div>
      <h1>Pokédex</h1>
      <p class="muted">
        Page {page} · {items.length} Pokémon
      </p>
      <div class="grid">
        {items.map((item) => (
          <PokemonCard item={item} likes={likes[String(item.id)] ?? 0} />
        ))}
      </div>
      <nav class="pager">
        {page > 1 ? <a href={`/?page=${page - 1}`}>← Prev</a> : <span />}
        {hasNext ? <a href={`/?page=${page + 1}`}>Next →</a> : <span />}
      </nav>
    </div>,
  );
});

export const pokedexRoute = app;
