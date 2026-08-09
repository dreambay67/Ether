import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: ["recovery/t15-reference-set-packaged.spec.ts"],
  outputDir: "../../test-results/t15-reference-set-packaged",
  timeout: 300_000,
  workers: 1,
  use: { trace: "on-first-retry" }
});
