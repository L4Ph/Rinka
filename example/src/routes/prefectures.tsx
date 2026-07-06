import { Hono } from "hono";
import { ErrorBoundary } from "hono/jsx";
import type { FC } from "hono/jsx";
import { fetchShops, type Shop } from "../lib/ramen";
import { renderer } from "../renderer";

const PrefectureShopList: FC<{ prefecture: string }> = async ({ prefecture }) => {
  const { shops }: { shops: Shop[] } = await fetchShops(1, 100, prefecture);

  return (
    <div>
      <h1>🍜 Ramen Shops in {prefecture}</h1>
      <p>{shops.length} shops loaded in a dynamic worker.</p>
      <ul>
        {shops.map((shop) => (
          <li key={shop.id}>
            <a href={`/shops/${encodeURIComponent(shop.id)}`}>{shop.name ?? shop.id}</a>
          </li>
        ))}
      </ul>
      <p>
        <a href="/">Back to all shops</a>
      </p>
    </div>
  );
};

const app = new Hono().use(renderer).get("/:prefecture/shops", (c) => {
  const prefecture = c.req.param("prefecture");
  return c.render(
    <ErrorBoundary fallback={<p>Something went wrong while loading shops.</p>}>
      <PrefectureShopList prefecture={prefecture} />
    </ErrorBoundary>,
  );
});

export const prefectureRoute = app;
