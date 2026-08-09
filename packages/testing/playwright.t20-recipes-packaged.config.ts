import { defineConfig } from "@playwright/test";
import { testSuites } from "./testSuites.js";

export default defineConfig({
  testDir: "./tests",
  testMatch: testSuites.recoveryT20Recipes.map((target) => target.replace(/^tests\//, "")),
  outputDir: "../../test-results/t20-recipes-packaged",
  timeout: 180_000,
  workers: 1,
  use: { trace: "on-first-retry" }
});
