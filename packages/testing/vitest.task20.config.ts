import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/local-output-publication.test.ts"],
    fileParallelism: false,
    maxWorkers: 1
  }
});
