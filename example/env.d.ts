export {};

declare global {
  interface CloudflareBindings {
    LOADER: WorkerLoader;
    ASSETS: Fetcher;
    LIKES_KV: KVNamespace;
  }
}
