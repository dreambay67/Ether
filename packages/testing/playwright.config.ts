import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  outputDir: "../../test-results",
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "on-first-retry"
  },
  webServer: {
    command: "pnpm.cmd --filter @ether/desktop dev:renderer",
    cwd: "../..",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
