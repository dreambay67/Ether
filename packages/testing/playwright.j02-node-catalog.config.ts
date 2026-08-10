import { defineConfig } from "@playwright/test";

import { testSuites } from "./testSuites.js";

export default defineConfig({
  testDir: "./tests",
  testMatch: testSuites.recoveryJ02NodeCatalog.map((target) => target.replace(/^tests\//, "")),
  outputDir: "../../test-results/j02-node-catalog",
  timeout: 240_000,
  workers: 1,
  use: { trace: "on-first-retry" }
});
