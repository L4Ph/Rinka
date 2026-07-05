import { Hono } from "hono";
import { ErrorBoundary } from "hono/jsx";
import type { FC } from "hono/jsx";
import { fetchShops } from "../lib/ramen";

const ShopList: FC = async () => {
  const { shops, totalCount } = await fetchShops(1, 100);
  const prefectures = Array.from(new Set(shops.map((s) => s.prefecture).filter(Boolean)));

  return (
    <div>
      <h1>🍜 Ramen Shops</h1>
      <p>{totalCount} shops loaded in a dynamic worker.</p>

      <section>
        <h2>By Prefecture</h2>
        <ul>
          {prefectures.map((pref) => (
            <li key={pref}>
              <a href={`/prefectures/${encodeURIComponent(pref ?? "")}/shops`}>{pref}</a>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>All Shops</h2>
        <ul>
          {shops.map((shop) => (
            <li key={shop.id}>
              <a href={`/shops/${encodeURIComponent(shop.id)}`}>{shop.name ?? shop.id}</a>
              {shop.prefecture && <span>（{shop.prefecture}）</span>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
};

const app = new Hono().get("/", (c) => {
  return c.render(
    <ErrorBoundary fallback={<p>Something went wrong while loading ramen shops.</p>}>
      <ShopList />
    </ErrorBoundary>,
  );
});

export const indexRoute = app;
