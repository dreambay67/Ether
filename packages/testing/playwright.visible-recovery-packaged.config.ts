import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "recovery/visible-recovery-packaged.spec.ts",
  outputDir: "../../test-results/visible-recovery-packaged",
  timeout: 120_000,
  workers: 1,
  use: { trace: "on-first-retry" }
});
