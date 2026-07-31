import { defineConfig } from "vitest/config";

import { testSuites } from "./testSuites.js";

const targetedSuiteNames = [
  "integration",
  "destructive-chaos",
  "contracts",
  "conformance:codex",
  "conformance:antigravity"
] as const;

type TargetedSuiteName = (typeof targetedSuiteNames)[number];

function isTargetedSuiteName(value: string): value is TargetedSuiteName {
  return targetedSuiteNames.some((suiteName) => suiteName === value);
}

const requestedSuite = process.env.ETHER_TEST_SUITE ?? "integration";
if (!isTargetedSuiteName(requestedSuite)) {
  throw new Error(`Unknown Ether integration suite: ${requestedSuite}.`);
}
if (
  requestedSuite === "destructive-chaos" &&
  process.env.ETHER_RUN_DESTRUCTIVE_CHAOS !== "1"
) {
  throw new Error(
    "Destructive recovery chaos is opt-in. Set ETHER_RUN_DESTRUCTIVE_CHAOS=1 and select the destructive-chaos suite."
  );
}
const include = testSuites[requestedSuite];

export default defineConfig({
  test: {
    environment: "node",
    include: [...include],
    fileParallelism: false,
    maxWorkers: 1,
    hookTimeout: 120_000,
    testTimeout: 120_000
  }
});
