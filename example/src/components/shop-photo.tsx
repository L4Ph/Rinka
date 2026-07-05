import type { FC } from "hono/jsx";

export const ShopPhoto: FC<{
  url: string;
  alt: string;
  width: number;
  height: number;
}> = ({ url, alt, width, height }) => (
  <img
    src={url}
    alt={alt}
    width={width}
    height={height}
    style="max-width:100%;height:auto;border-radius:8px;"
    loading="lazy"
  />
);
