import { Hono } from "hono";
import { ErrorBoundary } from "hono/jsx";
import type { FC } from "hono/jsx";
import { fetchShop } from "../lib/ramen";

const ShopDetail: FC<{ shopId: string }> = async ({ shopId }) => {
  const { shop } = await fetchShop(shopId);

  return (
    <div>
      <h1>{shop.name ?? shop.id}</h1>
      {shop.prefecture && <p>{shop.prefecture}</p>}

      <h2>Photos</h2>
      {shop.photos && shop.photos.length > 0 ? (
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:1rem;">
          {shop.photos.map((photo, index) => (
            <a
              key={photo.name}
              href={`/shops/${encodeURIComponent(shopId)}/photos/${index}`}
              style="display:block;"
            >
              <img
                src={photo.url}
                alt={photo.name}
                width={photo.width}
                height={photo.height}
                style="max-width:100%;height:auto;border-radius:8px;"
                loading="lazy"
              />
            </a>
          ))}
        </div>
      ) : (
        <p>No photos available.</p>
      )}

      <p>
        <a href="/">Back to shops</a>
      </p>
    </div>
  );
};

const app = new Hono().get("/:id", (c) => {
  const id = c.req.param("id");
  return c.render(
    <ErrorBoundary fallback={<p>Something went wrong while loading the shop.</p>}>
      <ShopDetail shopId={id} />
    </ErrorBoundary>,
  );
});

export const shopRoute = app;
