import { createHash } from "node:crypto";

import type { ExecutionPlan } from "@ether/schema";

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== "contentHash")
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function hashPlan(plan: Omit<ExecutionPlan, "contentHash"> | ExecutionPlan): string {
  return `sha256:v1:${createHash("sha256").update(canonicalJson(plan)).digest("hex")}`;
}

export function verifyPlanHash(plan: ExecutionPlan): boolean {
  return plan.contentHash === hashPlan(plan);
}
