import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import fs from "node:fs";
import path from "node:path";

const appBuildId = new Date().toISOString();
const basePath = normalizeBasePath(process.env.VITE_BASE_PATH ?? "/");

export default defineConfig({
  base: basePath,
  define: {
    __APP_BUILD_ID__: JSON.stringify(appBuildId),
  },
  plugins: [
    react(),
    emitVersionSnapshotPlugin(appBuildId),
    VitePWA({
      injectRegister: false,
      registerType: "autoUpdate",
      includeAssets: ["logo.svg"],
      workbox: {
        clientsClaim: true,
        skipWaiting: true,
        cleanupOutdatedCaches: true,
        globIgnores: ["**/version.json"],
        navigateFallback: `${basePath}index.html`,
      },
      manifest: {
        name: "!bangs.fast",
        short_name: "!bangs.fast",
        description: "Fast local bang redirects and search",
        display: "standalone",
        background_color: "#f3efe7",
        theme_color: "#1e5d4f",
        start_url: basePath,
        scope: basePath,
      },
    }),
  ],
  build: {
    sourcemap: false,
  },
});

function normalizeBasePath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "/") return "/";
  const withLeadingSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withLeadingSlash.endsWith("/") ? withLeadingSlash : `${withLeadingSlash}/`;
}

function emitVersionSnapshotPlugin(appBuild: string): import("vite").Plugin {
  const DATASET_IDS = ["kagi-community", "kagi-internal", "duckduckgo"] as const;

  const sanitizeDatasetHash = (value: unknown): string | null => {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    return trimmed;
  };

  return {
    name: "emit-version-snapshot",
    apply: "build",
    generateBundle() {
      const datasetHashes: Record<string, { hash: string }> = {};

      for (const sourceId of DATASET_IDS) {
        const datasetPath = path.resolve(process.cwd(), `public/datasets/${sourceId}.json`);
        try {
          const raw = fs.readFileSync(datasetPath, "utf8");
          const parsed = JSON.parse(raw) as { hash?: unknown };
          const hash = sanitizeDatasetHash(parsed.hash);
          if (hash) {
            datasetHashes[sourceId] = { hash };
          } else {
            this.warn(`[emit-version-snapshot] Missing dataset hash in ${datasetPath}`);
          }
        } catch (_error) {
          // Keep version emission resilient even if one dataset file cannot be parsed.
        }
      }

      const payload = {
        appBuildId: appBuild,
        generatedAt: new Date().toISOString(),
        datasets: datasetHashes,
      };

      this.emitFile({
        type: "asset",
        fileName: "version.json",
        source: `${JSON.stringify(payload)}\n`,
      });
    },
  };
}
