import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { build } from "vite";
import desktopViteConfig from "../../../apps/desktop/vite.config";

const repositoryRoot = path.resolve(import.meta.dirname, "../../..");

describe("desktop Vite packaging config", () => {
  it("uses relative asset paths so the Electron package can load from file URLs", () => {
    expect(desktopViteConfig).toMatchObject({
      base: "./"
    });
  });

  it("builds the renderer against the Ether 4.0 workspace packages", async () => {
    const outputDirectory = await mkdtemp(path.join(os.tmpdir(), "ether-desktop-vite-"));

    try {
      const result = await build({
          configFile: path.join(repositoryRoot, "apps/desktop/vite.config.ts"),
          root: path.join(repositoryRoot, "apps/desktop"),
          logLevel: "error",
          build: {
            outDir: outputDirectory,
            emptyOutDir: true
          }
        });
      expect(result).toBeDefined();
      const outputs = (Array.isArray(result) ? result : [result]).flatMap((item) => "output" in item ? item.output : []);
      const chunks = outputs.filter((item): item is Extract<typeof item, { type: "chunk" }> => item.type === "chunk");
      const entry = chunks.find((chunk) => chunk.isEntry);
      expect(entry?.dynamicImports.length).toBeGreaterThanOrEqual(4);
      expect(chunks.some((chunk) => /ArtifactBrowser/.test(chunk.name) && chunk.isDynamicEntry)).toBe(true);
      expect(chunks.some((chunk) => /BatchMatrix|JobCenter|TemplateGallery/.test(chunk.name) && chunk.isDynamicEntry)).toBe(true);
    } finally {
      await rm(outputDirectory, { recursive: true, force: true });
    }
  }, 60_000);
});
