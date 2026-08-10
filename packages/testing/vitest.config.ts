import { defineConfig } from "vitest/config";

import { testSuites } from "./testSuites.js";

export default defineConfig({
  test: {
    environment: "node",
    hookTimeout: process.env.CI === "true" ? 60_000 : 10_000,
    include: [...testSuites.unit],
    maxWorkers: process.env.CI === "true" ? 2 : undefined,
    testTimeout: process.env.CI === "true" ? 60_000 : 5_000
  }
});
