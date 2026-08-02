import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "recovery/document-lifecycle-recovery.spec.ts",
  outputDir: "../../test-results/document-lifecycle-recovery",
  timeout: 120_000,
  workers: 1,
  use: { trace: "on-first-retry" }
});
