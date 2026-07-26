import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // These are stable workspace boundaries, not a raised warning limit.
          if (id.includes("@xyflow/react") || id.includes("/renderer/canvas/")) return "canvas";
          if (id.includes("lucide-react")) return "icons";
          if (id.includes("/packages/schema/") || id.includes("/packages/graph-kernel/")) return "ether-graph";
          return undefined;
        }
      }
    }
  }
});
