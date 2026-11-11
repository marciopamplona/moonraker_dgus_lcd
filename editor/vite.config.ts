import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

// base "./" so dist/ works from file://, any static host, or the Pi bridge.
export default defineConfig({
  base: "./",
  plugins: [preact()],
  build: { outDir: "dist", emptyOutDir: true },
});
