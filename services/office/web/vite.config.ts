import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { buildAssetIndex, buildFurnitureCatalog } from "./src/vendor/pixel-agents/shared/assets/build";

const root = fileURLToPath(new URL(".", import.meta.url));
const assetsDir = path.join(root, "public/assets");
const target = process.env.OFFICE_API || "http://localhost:3100";

// Generates the metadata the pixel-agents browser runtime fetches:
// assets/furniture-catalog.json and assets/asset-index.json.
function pixelAssets(): Plugin {
  const serveJson = (build: () => unknown) => (_req: unknown, res: any) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(build()));
  };
  return {
    name: "pixel-assets",
    configureServer(server) {
      server.middlewares.use("/assets/furniture-catalog.json", serveJson(() => buildFurnitureCatalog(assetsDir)));
      server.middlewares.use("/assets/asset-index.json", serveJson(() => buildAssetIndex(assetsDir)));
    },
    closeBundle() {
      const out = path.join(root, "dist/assets");
      fs.mkdirSync(out, { recursive: true });
      fs.writeFileSync(path.join(out, "furniture-catalog.json"), JSON.stringify(buildFurnitureCatalog(assetsDir)));
      fs.writeFileSync(path.join(out, "asset-index.json"), JSON.stringify(buildAssetIndex(assetsDir)));
    },
  };
}

export default defineConfig({
  root,
  plugins: [react(), tailwindcss(), pixelAssets()],
  build: { outDir: "dist", emptyOutDir: true, chunkSizeWarningLimit: 1500 },
  server: {
    port: 5173,
    proxy: { "/api": { target, changeOrigin: true }, "/a2a": { target, changeOrigin: true } },
  },
});
