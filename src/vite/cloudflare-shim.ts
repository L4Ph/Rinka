import type { Plugin } from "vite-plus";

export const cloudflareShim: Plugin = {
  name: "hibana:cloudflare-shim",
  resolveId(id) {
    if (id.startsWith("cloudflare:")) return `\0${id}`;
  },
  load(id) {
    if (!id.startsWith("\0cloudflare:")) return;
    return `
      export class DurableObject {
        constructor(state, env) { this.state = state; this.env = env; }
      }
      export class WorkerEntrypoint {}
      export class WorkflowEntrypoint {}
      export const env = {};
    `;
  },
};
