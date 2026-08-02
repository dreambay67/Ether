import { defineConfig } from "@playwright/test";

import { testSuites } from "./testSuites.js";

export default defineConfig({
  testDir: "./tests",
  testMatch: testSuites.recoveryWindowsIntegration.map((target) => target.replace(/^tests\//, "")),
  outputDir: "../../test-results/document-windows-integration",
  timeout: 150_000,
  workers: 1,
  use: { trace: "on-first-retry" }
});
