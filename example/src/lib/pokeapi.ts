const API = "https://pokeapi.co/api/v2";
const USER_AGENT = "rinka-example/0.1 (+https://github.com/L4Ph/Rinka)";

export const PAGE_SIZE = 24;

/** One entry in the Pokédex list. */
export type PokemonListItem = {
  id: number;
  name: string;
};

export type PokemonStat = {
  name: string;
  value: number;
};

export type PokemonAbility = {
  name: string;
  hidden: boolean;
};

export type Pokemon = {
  id: number;
  name: string;
  /** Decimetres, per the API. */
  height: number;
  /** Hectograms, per the API. */
  weight: number;
  types: string[];
  abilities: PokemonAbility[];
  stats: PokemonStat[];
  artwork: string;
};

export type PokemonSpecies = {
  /** e.g. "Mouse Pokémon". */
  genus: string;
  flavor: string;
  color: string;
};

export function artworkUrl(id: number): string {
  return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`;
}

export function dexNumber(id: number): string {
  return `#${String(id).padStart(4, "0")}`;
}

function idFromUrl(url: string): number {
  const match = url.match(/\/(\d+)\/?$/);
  return match ? Number(match[1]) : 0;
}

async function getJson(url: string): Promise<Response> {
  return fetch(url, { headers: { "User-Agent": USER_AGENT } });
}

export type PokedexPage = {
  page: number;
  hasNext: boolean;
  items: PokemonListItem[];
};

export async function fetchPokedex(page = 1): Promise<PokedexPage> {
  const offset = (Math.max(1, page) - 1) * PAGE_SIZE;
  const res = await getJson(`${API}/pokemon?limit=${PAGE_SIZE}&offset=${offset}`);
  if (!res.ok) throw new Error(`pokeapi responded ${res.status}`);
  const data = (await res.json()) as {
    next: string | null;
    results: { name: string; url: string }[];
  };
  return {
    page,
    hasNext: Boolean(data.next),
    items: data.results.map((entry) => ({ id: idFromUrl(entry.url), name: entry.name })),
  };
}

export async function fetchPokemon(id: string): Promise<Pokemon | null> {
  const res = await getJson(`${API}/pokemon/${encodeURIComponent(id)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`pokeapi responded ${res.status}`);
  const data = (await res.json()) as {
    id: number;
    name: string;
    height: number;
    weight: number;
    types: { type: { name: string } }[];
    abilities: { ability: { name: string }; is_hidden: boolean }[];
    stats: { base_stat: number; stat: { name: string } }[];
    sprites?: { other?: { "official-artwork"?: { front_default?: string | null } } };
  };
  return {
    id: data.id,
    name: data.name,
    height: data.height,
    weight: data.weight,
    types: data.types.map((entry) => entry.type.name),
    abilities: data.abilities.map((entry) => ({
      name: entry.ability.name,
      hidden: entry.is_hidden,
    })),
    stats: data.stats.map((entry) => ({ name: entry.stat.name, value: entry.base_stat })),
    artwork: data.sprites?.other?.["official-artwork"]?.front_default ?? artworkUrl(data.id),
  };
}

export async function fetchSpecies(id: string): Promise<PokemonSpecies | null> {
  const res = await getJson(`${API}/pokemon-species/${encodeURIComponent(id)}`);
  if (!res.ok) return null;
  const data = (await res.json()) as {
    color?: { name?: string };
    genera?: { genus: string; language: { name: string } }[];
    flavor_text_entries?: { flavor_text: string; language: { name: string } }[];
  };
  const genus = data.genera?.find((entry) => entry.language.name === "en")?.genus ?? "";
  const flavor =
    data.flavor_text_entries?.find((entry) => entry.language.name === "en")?.flavor_text ?? "";
  return {
    genus,
    flavor: flavor.replace(/[\n\f\r]+/g, " ").trim(),
    color: data.color?.name ?? "",
  };
}
