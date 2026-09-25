import { Hono } from "hono";
import { renderer } from "../renderer";

const app = new Hono().use(renderer).get("/", (c) => {
  c.header("Cache-Control", "public, max-age=300");
  return c.render(
    <div>
      <h1>About</h1>
      <p>
        Data and sprites from{" "}
        <a href="https://pokeapi.co/" target="_blank" rel="noopener noreferrer">
          PokéAPI
        </a>
        . This route runs <strong>inline in the host Worker</strong> — the Pokédex and detail pages
        run in dynamically-loaded Worker isolates instead.
      </p>
      <p>
        Likes are stored in KV and reached from the isolates through a <code>WorkerEntrypoint</code>{" "}
        loopback binding.
      </p>
      <p>
        GET responses set <code>Cache-Control</code>, so{" "}
        <a href="https://developers.cloudflare.com/workers/cache/">Workers Cache</a> serves repeated
        views from the edge without running the Worker.
      </p>
      <p>
        <a href="/">Back to Pokédex</a>
      </p>
    </div>,
  );
});

export const aboutRoute = app;
