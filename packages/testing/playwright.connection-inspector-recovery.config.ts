import { defineConfig } from "@playwright/test";

import { testSuites } from "./testSuites.js";

export default defineConfig({
  testDir: "./tests",
  testMatch: testSuites.recoveryConnectionInspector.map((target) => target.replace(/^tests\//, "")),
  outputDir: "../../test-results/connection-inspector-recovery",
  timeout: 240_000,
  workers: 1,
  use: { trace: "on-first-retry" }
});
