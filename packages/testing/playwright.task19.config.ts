import { defineConfig, devices } from "@playwright/test";

const port = 5189;

export default defineConfig({
  testDir: "./tests/desktop",
  testMatch: "artifacts-review.spec.ts",
  outputDir: "../../test-results/desktop-task19",
  timeout: 60_000,
  use: { baseURL: `http://127.0.0.1:${port}`, trace: "on-first-retry" },
  webServer: {
    command: `pnpm.cmd --filter @ether/desktop exec vite --host 127.0.0.1 --port ${port} --strictPort`,
    cwd: "../..",
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: true,
    timeout: 60_000
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }]
});
