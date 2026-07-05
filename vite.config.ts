import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    isolate: false,
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  pack: {
    entry: ["src/index.ts", "src/proxies.ts", "src/vite/plugin.ts"],
  },
  staged: {
    "*.{js,ts,tsx,vue,svelte,md,json}": "vp check --fix",
  },
});
