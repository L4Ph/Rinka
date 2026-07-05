import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite-plus";
import { rinkaVitePlugin } from "rinka/vite";
import { defineBindingPolicies } from "rinka";

type Env = {};

export default defineConfig({
  plugins: [
    rinkaVitePlugin({
      root: __dirname,
      appEntry: "src/index.tsx",
      scanFile: "src/index.tsx",
      manifestOut: "src/generated/dynamic-manifest.ts",
      assetsDir: "public/dynamic-routes",
      bindingPolicies: defineBindingPolicies<Env>({}),
    }),
    cloudflare(),
  ],
});
