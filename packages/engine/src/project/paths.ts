import path from "node:path";

export const REQUIRED_DIRECTORIES = [
  "assets/references",
  "assets/generated",
  "assets/masks",
  "assets/previews",
  "collections",
  "directories",
  "runs",
  "templates",
  "exports",
  "snapshots"
] as const;

export const REQUIRED_FILES = [
  "project.json",
  "graph.json",
  "ether.db",
  "assets/references/linked-index.json",
  "runs/run-log.jsonl"
] as const;

export function sanitizeProjectFolderName(name: string) {
  const safeName = name
    .trim()
    .replace(/[^a-zA-Z0-9 _.-]/g, "")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "");

  if (!safeName) {
    throw new Error("Project name must contain at least one valid filename character.");
  }

  return safeName;
}

export function projectPaths(projectPath: string) {
  return {
    root: projectPath,
    projectJson: path.join(projectPath, "project.json"),
    graphJson: path.join(projectPath, "graph.json"),
    database: path.join(projectPath, "ether.db"),
    linkedIndex: path.join(projectPath, "assets", "references", "linked-index.json"),
    runLog: path.join(projectPath, "runs", "run-log.jsonl"),
    snapshots: path.join(projectPath, "snapshots")
  };
}
