import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "recovery/t21-plugin-coproduction-packaged.spec.ts",
  outputDir: "../../test-results/t21-plugin-coproduction-packaged",
  timeout: 180_000,
  workers: 1,
  use: { trace: "on-first-retry" }
});
