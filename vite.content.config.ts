import { defineConfig } from "vite";
import { resolve } from "node:path";

// Content scripts must be classic scripts, so this entry is built on its own as a
// self-contained IIFE (no shared chunks, no `import`). Runs after the main build,
// which owns emptying dist/ and copying public/.
export default defineConfig(({ mode }) => ({
  publicDir: false,
  build: {
    outDir: "dist",
    emptyOutDir: false,
    sourcemap: mode !== "release",
    lib: {
      entry: resolve(import.meta.dirname, "src/content.ts"),
      formats: ["iife"],
      name: "HybridPhishGuardContent",
      fileName: () => "content.js",
    },
  },
}));
