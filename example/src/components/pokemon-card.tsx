import type { FC } from "hono/jsx";
import { artworkUrl, dexNumber, type PokemonListItem } from "../lib/pokeapi";

export const PokemonCard: FC<{ item: PokemonListItem; likes: number }> = ({ item, likes }) => (
  <figure class="card">
    <a class="card-link" href={`/pokemon/${item.id}`}>
      <img
        src={artworkUrl(item.id)}
        width={200}
        height={200}
        alt={item.name}
        loading="lazy"
        referrerpolicy="no-referrer"
      />
    </a>
    <figcaption>
      <span class="dexno">{dexNumber(item.id)}</span>
      <span class="pname">{item.name}</span>
      <form method="post" action={`/pokemon/${item.id}/like`}>
        <button type="submit" class="like" aria-label={`like ${item.name}`}>
          ♥ <span>{likes}</span>
        </button>
      </form>
    </figcaption>
  </figure>
);
