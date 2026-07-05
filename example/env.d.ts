export {};

declare global {
  interface CloudflareBindings {
    LOADER: WorkerLoader;
    ASSETS: Fetcher;
  }
}
