import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/performance",
  // Candidate evidence must exercise the installed release artifact. Browser-only
  // benchmarks live behind the explicit diagnostic command instead.
  testMatch: ["desktop.production.performance.spec.ts"],
  outputDir: "../../test-results/performance",
  timeout: 120_000,
  workers: 1,
  use: { trace: "on-first-retry", ...devices["Desktop Chrome"] }
});
