import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@ether/engine/graph/nodeCatalog": path.resolve(
        __dirname,
        "../../packages/engine/src/graph/nodeCatalog.ts"
      ),
      "@ether/engine/graph/connectionRules": path.resolve(
        __dirname,
        "../../packages/engine/src/graph/connectionRules.ts"
      ),
      "@ether/engine/graph/canvasGeometry": path.resolve(
        __dirname,
        "../../packages/engine/src/graph/canvasGeometry.ts"
      )
    }
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true
  },
  build: {
    outDir: "dist",
    emptyOutDir: true
  }
});
