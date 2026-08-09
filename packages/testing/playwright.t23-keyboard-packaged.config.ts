import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: ["recovery/t23-keyboard-packaged.spec.ts", "recovery/t23-j06-keyboard-packaged.spec.ts"],
  outputDir: "../../test-results/t23-keyboard-packaged",
  timeout: 240_000,
  workers: 1,
  use: { trace: "on-first-retry" }
});
