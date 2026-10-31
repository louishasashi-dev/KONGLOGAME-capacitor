import { cpSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const root = process.cwd();

function copyGameAssets() {
  return {
    name: "copy-game-assets",
    apply: "build",
    closeBundle() {
      const source = resolve(root, "assets");
      if (existsSync(source)) {
        cpSync(source, resolve(root, "dist", "assets"), { recursive: true });
      }
    },
  };
}

export default defineConfig({
  base: "./",
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  plugins: [copyGameAssets()],
});
