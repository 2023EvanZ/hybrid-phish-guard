import { defineConfig } from "vite";
import { resolve } from "node:path";

// Entries: the side panel page, the offscreen document (where the models run) and the
// MV3 service worker.
// Everything is bundled locally because MV3 forbids remotely hosted code.
//
// `--mode release` (npm run build:release) builds what gets zipped for judges and users:
// no sourcemaps, and the App Check debug token is blanked at compile time, so it can't end
// up in the bundle even though .env is loaded in every mode. scripts/package-release.ts
// double-checks the output before zipping.
export default defineConfig(({ mode }) => {
  const release = mode === "release";
  return {
    define: release ? { "import.meta.env.VITE_APPCHECK_DEBUG_TOKEN": JSON.stringify("") } : {},
    build: {
      outDir: "dist",
      emptyOutDir: true,
      sourcemap: !release,
      rollupOptions: {
        input: {
          sidepanel: resolve(import.meta.dirname, "sidepanel.html"),
          modeleval: resolve(import.meta.dirname, "modeleval.html"),
          offscreen: resolve(import.meta.dirname, "offscreen.html"),
          background: resolve(import.meta.dirname, "src/background.ts"),
        },
        output: {
          entryFileNames: "[name].js",
          chunkFileNames: "chunks/[name]-[hash].js",
          assetFileNames: "assets/[name]-[hash][extname]",
        },
      },
    },
  };
});
