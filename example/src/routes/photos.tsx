import { Hono } from "hono";
import { ErrorBoundary } from "hono/jsx";
import type { FC } from "hono/jsx";
import { ShopPhoto } from "../components/shop-photo";
import { fetchShop, type Author, type Photo, type Shop } from "../lib/ramen";

const PhotoDetail: FC<{ shopId: string; index: number }> = async ({ shopId, index }) => {
  const { shop }: { shop: Shop } = await fetchShop(shopId);
  const photo: Photo | undefined = shop.photos?.[index];
  if (!photo) throw new Error("Photo not found");

  return (
    <div>
      <h1>
        {shop.name ?? shop.id} — Photo #{index + 1}
      </h1>
      <ShopPhoto url={photo.url} alt={photo.name} width={photo.width} height={photo.height} />
      {photo.author && <p>Photo by {(photo.author as Author).name}</p>}
      <p>
        <a href={`/shops/${encodeURIComponent(shopId)}`}>Back to {shop.name ?? shop.id}</a>
      </p>
    </div>
  );
};

const app = new Hono().get("/:id/photos/:index", (c) => {
  const id = c.req.param("id");
  const index = Number.parseInt(c.req.param("index"), 10);
  if (Number.isNaN(index) || index < 0) return c.notFound();

  return c.render(
    <ErrorBoundary fallback={<p>Something went wrong while loading the photo.</p>}>
      <PhotoDetail shopId={id} index={index} />
    </ErrorBoundary>,
  );
});

export const photoRoute = app;
