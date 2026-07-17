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

  it("builds the renderer against the CommonJS engine package", async () => {
    const outputDirectory = await mkdtemp(path.join(os.tmpdir(), "ether-desktop-vite-"));

    try {
      await expect(
        build({
          configFile: path.join(repositoryRoot, "apps/desktop/vite.config.ts"),
          root: path.join(repositoryRoot, "apps/desktop"),
          logLevel: "error",
          build: {
            outDir: outputDirectory,
            emptyOutDir: true
          }
        })
      ).resolves.toBeDefined();
    } finally {
      await rm(outputDirectory, { recursive: true, force: true });
    }
  });
});
