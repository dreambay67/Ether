import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.packaged.ts",
  outputDir: "../../test-results/packaged",
  timeout: 60_000,
  workers: 1,
  use: {
    trace: "on-first-retry"
  }
});
