import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "recovery/t22-packaged-shell-matrix.spec.ts",
  outputDir: "../../test-results/t22-packaged-shell-matrix",
  timeout: 240_000,
  workers: 1,
  use: { trace: "on-first-retry" }
});
