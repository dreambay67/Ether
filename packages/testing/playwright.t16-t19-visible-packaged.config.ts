import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: ["recovery/t16-t19-visible-packaged.spec.ts"],
  outputDir: "../../test-results/t16-t19-visible-packaged",
  timeout: 300_000,
  workers: 1,
  use: { trace: "on-first-retry" }
});
