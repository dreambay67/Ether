import { defineConfig, devices } from "@playwright/test";

import { testSuites } from "./testSuites.js";

const port = Number(process.env.ETHER_PLAYWRIGHT_PORT ?? 5174);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests",
  testMatch: testSuites.smoke.map((target) => target.replace(/^tests\//, "")),
  outputDir: "../../test-results",
  timeout: 30_000,
  use: {
    baseURL,
    trace: "on-first-retry"
  },
  webServer: {
    command: `pnpm.cmd --filter @ether/desktop exec vite --host 127.0.0.1 --port ${port} --strictPort`,
    cwd: "../..",
    url: baseURL,
    reuseExistingServer: process.env.ETHER_PLAYWRIGHT_REUSE_SERVER === "1",
    timeout: 60_000
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
