import { defineConfig } from "@playwright/test";

import { testSuites } from "./testSuites.js";

export default defineConfig({
  testDir: "./tests",
  testMatch: testSuites.recoveryDocumentLifecycle.map((target) => target.replace(/^tests\//, "")),
  outputDir: "../../test-results/document-lifecycle-recovery",
  // This is one deliberate end-to-end document journey: three packaged app
  // launches, native Save/Save As/Copy dialogs, compaction, portability,
  // writer contention, a hard restart, and a clean accessibility close.
  timeout: 480_000,
  workers: 1,
  use: { trace: "on-first-retry" }
});
