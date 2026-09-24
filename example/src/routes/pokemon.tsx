import { Hono } from "hono";
import type { FC } from "hono/jsx";
import type { LikesService } from "../lib/likes";
import {
  dexNumber,
  fetchPokemon,
  fetchSpecies,
  type Pokemon,
  type PokemonSpecies,
} from "../lib/pokeapi";
import { renderer } from "../renderer";

type Bindings = { LIKES: LikesService };

const TYPE_COLOR: Record<string, string> = {
  normal: "#9099a1",
  fire: "#ff9d55",
  water: "#4d90d5",
  electric: "#f4d23c",
  grass: "#63bc5a",
  ice: "#73cec0",
  fighting: "#ce416b",
  poison: "#aa6bc8",
  ground: "#d97845",
  flying: "#8fa8dd",
  psychic: "#fa7179",
  bug: "#91c12f",
  rock: "#c5b78c",
  ghost: "#5269ad",
  dragon: "#0b6dc3",
  dark: "#5a5465",
  steel: "#5a8ea2",
  fairy: "#ec8fe6",
};

const STAT_LABEL: Record<string, string> = {
  hp: "HP",
  attack: "Atk",
  defense: "Def",
  "special-attack": "SpA",
  "special-defense": "SpD",
  speed: "Spe",
};

const titleCase = (value: string): string =>
  value.replace(/-/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());

const Detail: FC<{ pokemon: Pokemon; species: PokemonSpecies | null; likes: number }> = ({
  pokemon,
  species,
  likes,
}) => (
  <div>
    <p>
      <a href="/">← Back to Pokédex</a>
    </p>
    <div class="detail">
      <img
        class="detail-image"
        src={pokemon.artwork}
        width={320}
        height={320}
        alt={pokemon.name}
        referrerpolicy="no-referrer"
      />
      <div class="detail-body">
        <span class="dexno">{dexNumber(pokemon.id)}</span>
        <h1>{titleCase(pokemon.name)}</h1>
        {species?.genus ? <p class="muted">{species.genus}</p> : null}
        <ul class="types">
          {pokemon.types.map((type) => (
            <li style={`background:${TYPE_COLOR[type] ?? "#888"}`}>{titleCase(type)}</li>
          ))}
        </ul>
        <form method="post" action={`/pokemon/${pokemon.id}/like`}>
          <button type="submit" class="like like-lg">
            ♥ <span>{likes}</span> {likes === 1 ? "like" : "likes"}
          </button>
        </form>
      </div>
    </div>

    {species?.flavor ? <p class="flavor">{species.flavor}</p> : null}

    <h2>Base stats</h2>
    <ul class="stats">
      {pokemon.stats.map((stat) => (
        <li>
          <span class="stat-label">{STAT_LABEL[stat.name] ?? stat.name}</span>
          <span class="stat-bar">
            <span class="stat-fill" style={`width:${Math.min(100, (stat.value / 200) * 100)}%`} />
          </span>
          <span class="stat-value">{stat.value}</span>
        </li>
      ))}
    </ul>

    <h2>Details</h2>
    <ul class="facts">
      <li>Height: {(pokemon.height / 10).toFixed(1)} m</li>
      <li>Weight: {(pokemon.weight / 10).toFixed(1)} kg</li>
      <li>
        Abilities:{" "}
        {pokemon.abilities
          .map((ability) => titleCase(ability.name) + (ability.hidden ? " (hidden)" : ""))
          .join(", ")}
      </li>
    </ul>
  </div>
);

const app = new Hono<{ Bindings: Bindings }>()
  .use(renderer)
  .post("/:id/like", async (c) => {
    await c.env.LIKES.like(c.req.param("id"));
    // POSTs bypass Workers Cache, but mark the redirect no-store to be explicit.
    c.header("Cache-Control", "no-store");
    return c.redirect(c.req.header("Referer") ?? `/pokemon/${c.req.param("id")}`, 303);
  })
  .get("/:id", async (c) => {
    const id = c.req.param("id");
    const [pokemon, species] = await Promise.all([fetchPokemon(id), fetchSpecies(id)]);
    if (!pokemon) return c.notFound();
    const likes = await c.env.LIKES.count(String(pokemon.id));
    c.header("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
    return c.render(<Detail pokemon={pokemon} species={species} likes={likes} />);
  });

export const pokemonRoute = app;
