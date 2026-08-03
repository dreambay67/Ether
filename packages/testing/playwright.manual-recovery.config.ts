import { defineConfig } from "@playwright/test";

import { testSuites } from "./testSuites.js";

export default defineConfig({
  testDir: "./tests",
  testMatch: testSuites.recoveryManual.map((target) => target.replace(/^tests\//, "")),
  outputDir: "../../test-results/manual-recovery",
  timeout: 300_000,
  workers: 1,
  use: { trace: "on-first-retry" }
});
