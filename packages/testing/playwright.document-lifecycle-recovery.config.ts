import { defineConfig } from "@playwright/test";

import { testSuites } from "./testSuites.js";

export default defineConfig({
  testDir: "./tests",
  testMatch: testSuites.recoveryDocumentLifecycle.map((target) => target.replace(/^tests\//, "")),
  outputDir: "../../test-results/document-lifecycle-recovery",
  timeout: 120_000,
  workers: 1,
  use: { trace: "on-first-retry" }
});
