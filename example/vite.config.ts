import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite-plus";
import { rinkaVitePlugin } from "rinka/vite";

export default defineConfig({
  plugins: [
    rinkaVitePlugin({
      root: __dirname,
      appEntry: "src/index.tsx",
      assetsDir: "public/dynamic-routes",
    }),
    cloudflare(),
  ],
});
