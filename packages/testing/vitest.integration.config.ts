import { defineConfig } from "vitest/config";

import { testSuites } from "./testSuites.js";

const targetedSuiteNames = [
  "integration",
  "contracts",
  "conformance:codex",
  "conformance:antigravity"
] as const;

type TargetedSuiteName = (typeof targetedSuiteNames)[number];

function isTargetedSuiteName(value: string): value is TargetedSuiteName {
  return targetedSuiteNames.some((suiteName) => suiteName === value);
}

const requestedSuite = process.env.ETHER_TEST_SUITE ?? "integration";
const include = isTargetedSuiteName(requestedSuite)
  ? testSuites[requestedSuite]
  : testSuites.integration;

export default defineConfig({
  test: {
    environment: "node",
    include: [...include],
    fileParallelism: false,
    maxWorkers: 1
  }
});
