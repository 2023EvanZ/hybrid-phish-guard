import { defineConfig } from "vite";
import { resolve } from "node:path";

// Entries: the side panel page, the offscreen document (where the models run) and the
// MV3 service worker.
// Everything is bundled locally because MV3 forbids remotely hosted code.
//
// `--mode release` (npm run build:release) builds what gets zipped for judges and users:
// no sourcemaps, no App Check (src/appcheck.ts is swapped for a no-op), and the debug token
// blanked at compile time as a second layer, since .env is loaded in every mode. scripts/package-release.ts
// double-checks the output before zipping.
export default defineConfig(({ mode }) => {
  const release = mode === "release";
  return {
    define: release ? { "import.meta.env.VITE_APPCHECK_DEBUG_TOKEN": JSON.stringify("") } : {},
    // Release builds get a no-op App Check module, so the App Check library isn't bundled.
    resolve: release
      ? { alias: [{ find: /^\.\/appcheck\.ts$/, replacement: resolve(import.meta.dirname, "src/appcheck.release.ts") }] }
      : {},
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
