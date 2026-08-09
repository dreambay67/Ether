import { defineConfig } from "@playwright/test";

import { testSuites } from "./testSuites.js";

export default defineConfig({
  testDir: "./tests",
  testMatch: testSuites.recoveryT14WorkerReview.map((target) => target.replace(/^tests\//, "")),
  outputDir: "../../test-results/t14-worker-review-packaged",
  timeout: 300_000,
  workers: 1,
  use: { trace: "on-first-retry" }
});
