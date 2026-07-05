export type Author = {
  id: string;
  name: string;
  url: string;
};

export type Photo = {
  name: string;
  url: string;
  width: number;
  height: number;
  authorId?: string;
  author?: Author;
};

export type Shop = {
  id: string;
  name?: string;
  prefecture?: string;
  photos?: Photo[];
};

export type ShopsResponse = {
  shops: Shop[];
  totalCount: number;
  pageInfo: {
    nextPage: number | null;
    prevPage: number | null;
    lastPage: number;
    perPage: number;
    currentPage: number;
  };
};

const BASE_URL = "https://ramen-api.dev";

async function fetchJson<T>(url: string | URL, errorMessage: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${errorMessage}: ${res.status}`);
  return res.json();
}

export async function fetchShops(
  page = 1,
  perPage = 100,
  prefecture?: string,
): Promise<ShopsResponse> {
  const url = new URL(`${BASE_URL}/shops`);
  url.searchParams.set("page", String(page));
  url.searchParams.set("perPage", String(perPage));
  if (prefecture) url.searchParams.set("prefecture", prefecture);

  return fetchJson(url, "Failed to fetch shops");
}

export async function fetchShop(id: string): Promise<{ shop: Shop }> {
  return fetchJson(`${BASE_URL}/shops/${encodeURIComponent(id)}`, `Failed to fetch shop ${id}`);
}
