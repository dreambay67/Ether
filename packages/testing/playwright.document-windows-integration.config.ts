import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "recovery/document-windows-integration.spec.ts",
  outputDir: "../../test-results/document-windows-integration",
  timeout: 150_000,
  workers: 1,
  use: { trace: "on-first-retry" }
});
