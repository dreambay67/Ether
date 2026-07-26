import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.ETHER_PLAYWRIGHT_PERFORMANCE_PORT ?? 5176);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/performance",
  testMatch: ["canvas.browser.performance.spec.ts", "desktop.production.performance.spec.ts"],
  outputDir: "../../test-results/performance",
  timeout: 60_000,
  workers: 1,
  use: { baseURL, trace: "on-first-retry", ...devices["Desktop Chrome"] },
  webServer: {
    command: `pnpm.cmd --filter @ether/desktop build:performance && pnpm.cmd --filter @ether/desktop exec vite preview --host 127.0.0.1 --port ${port} --strictPort`,
    cwd: "../..",
    url: baseURL,
    reuseExistingServer: process.env.ETHER_PLAYWRIGHT_REUSE_SERVER === "1",
    timeout: 180_000
  }
});
