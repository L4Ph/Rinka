import { Hono } from "hono";
import { renderer } from "../renderer";

const app = new Hono().use(renderer).get("/", (c) => {
  return c.render(
    <div>
      <h1>About</h1>
      <p>
        This example uses{" "}
        <a href="https://github.com/yusukebe/ramen-api" target="_blank" rel="noopener noreferrer">
          Ramen API
        </a>{" "}
        by Yusuke Wada.
      </p>
      <p>Powered by Hono, rinka, and Cloudflare Workers.</p>
      <p>
        <a href="/">Back to shops</a>
      </p>
    </div>,
  );
});

export const aboutRoute = app;
