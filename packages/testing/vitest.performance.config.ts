import { defineConfig } from "vitest/config";

import { testSuites } from "./testSuites.js";

export default defineConfig({
  test: {
    environment: "node",
    include: [...testSuites.performance],
    fileParallelism: false,
    maxWorkers: 1,
    sequence: {
      concurrent: false
    },
    testTimeout: 120_000
  }
});
