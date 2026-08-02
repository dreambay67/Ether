import { defineConfig } from "@playwright/test";

import { testSuites } from "./testSuites.js";

export default defineConfig({
  testDir: "./tests",
  testMatch: testSuites.recoveryVisiblePackaged.map((target) => target.replace(/^tests\//, "")),
  outputDir: "../../test-results/visible-recovery-packaged",
  timeout: 120_000,
  workers: 1,
  use: { trace: "on-first-retry" }
});
