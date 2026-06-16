import { access } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { replaceHealthIssues } from "./database.js";
import { projectPaths } from "./paths.js";
import { readJson } from "./projectStore.js";
import { LinkedIndexSchema, type HealthCheckResult, type HealthIssue } from "./schema.js";

export async function runHealthCheck(projectPath: string): Promise<HealthCheckResult> {
  const paths = projectPaths(projectPath);
  const linkedIndex = LinkedIndexSchema.parse(await readJson(paths.linkedIndex));
  const detectedAt = new Date().toISOString();
  const issues: HealthIssue[] = [];

  for (const reference of linkedIndex.references) {
    if (!(await canAccess(reference.path))) {
      issues.push({
        id: randomUUID(),
        code: "LINKED_REFERENCE_MISSING",
        severity: "error",
        message: `Linked reference is missing: ${reference.path}`,
        path: reference.path,
        detectedAt
      });
    }
  }

  replaceHealthIssues(paths.database, issues);

  return { issues };
}

async function canAccess(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
