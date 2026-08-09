import { defineConfig } from "@playwright/test";

import { testSuites } from "./testSuites.js";

export default defineConfig({
  testDir: "./tests",
  testMatch: testSuites.recoveryT13RunSafety.map((target) => target.replace(/^tests\//, "")),
  outputDir: "../../test-results/t13-run-safety-packaged",
  timeout: 300_000,
  workers: 1,
  use: { trace: "on-first-retry" }
});
