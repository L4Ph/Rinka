/**
 * The `LIKES` binding a dynamic route receives. It is a loopback: the route calls
 * these methods over RPC, and the host Worker's `Likes` `WorkerEntrypoint` runs
 * them where the KV namespace lives.
 */
export type LikesService = {
  count(id: string): Promise<number>;
  counts(ids: string[]): Promise<Record<string, number>>;
  like(id: string): Promise<number>;
};

export function likeKey(id: string): string {
  return `like:${id}`;
}
