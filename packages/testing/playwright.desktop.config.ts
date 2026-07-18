import { defineConfig } from "@playwright/test";

import { testSuites } from "./testSuites.js";

export default defineConfig({
  testDir: "./tests",
  testMatch: testSuites.desktop.map((target) => target.replace(/^tests\//, "")),
  outputDir: "../../test-results/desktop",
  timeout: 60_000,
  workers: 1,
  use: { trace: "on-first-retry" }
});
