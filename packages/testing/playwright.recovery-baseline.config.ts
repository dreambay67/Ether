import { defineConfig } from "@playwright/test";

import { testSuites } from "./testSuites.js";

export default defineConfig({
  testDir: "./tests",
  testMatch: testSuites.recoveryBaseline.map((target) => target.replace(/^tests\//, "")),
  outputDir: "../../test-results/recovery-baseline",
  timeout: 120_000,
  workers: 1,
  use: { trace: "on-first-retry" }
});
