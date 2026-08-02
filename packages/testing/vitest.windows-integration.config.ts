import { defineConfig } from "vitest/config";

/** Package-independent safety contracts for the approval-gated A02 Windows harness. */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/windows-integration-contract.test.ts"]
  }
});
