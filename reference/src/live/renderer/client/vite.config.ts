import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  root: __dirname,
  publicDir: false,
  build: {
    outDir: path.resolve(__dirname, "../../../../dist/live-renderer"),
    emptyOutDir: true,
    target: "es2022",
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("pixi-live2d-display")) return "live2d";
          if (id.includes("pixi.js")) return "pixi";
        },
      },
    },
  },
});
