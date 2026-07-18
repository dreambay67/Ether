import { createHash } from "node:crypto";

import { canonicalJson, canonicalPlanJson, type ExecutionPlan } from "@ether/schema";

export { canonicalJson, canonicalPlanJson };

export function hashPlan(plan: Omit<ExecutionPlan, "contentHash"> | ExecutionPlan): string {
  return `sha256:v1:${createHash("sha256").update(canonicalPlanJson(plan)).digest("hex")}`;
}

export function verifyPlanHash(plan: ExecutionPlan): boolean {
  return plan.contentHash === hashPlan(plan);
}
