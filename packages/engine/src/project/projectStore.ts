import { constants } from "node:fs";
import { access, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { initializeDatabase } from "./database.js";
import { projectPaths, REQUIRED_DIRECTORIES, REQUIRED_FILES, sanitizeProjectFolderName } from "./paths.js";
import {
  createInitialGraphRevision,
  getLatestGraphRevision,
  saveGraphRevision
} from "../revisions/revisionStore.js";
import type { GraphRevision } from "../revisions/types.js";
import {
  LATEST_GRAPH_VERSION,
  ProjectMetadataSchema,
  normalizeEtherGraph,
  type CreateProjectOptions,
  type EtherGraph,
  type EtherGraphInput,
  type ProjectMetadata,
  type ProjectOpenResult
} from "./schema.js";

const APP_VERSION = "0.1.0";
const BRAND_LOCKUP = "ETHER by DreamBay";

type WriteJson = typeof writeJson;
type TestWriteJson = (
  filePath: string,
  value: unknown,
  writeDefault: WriteJson
) => Promise<void>;

let writeJsonForProjectStore: TestWriteJson = (filePath, value, writeDefault) =>
  writeDefault(filePath, value);

export function __setProjectStoreTestHooks(hooks: { writeJson?: TestWriteJson }) {
  writeJsonForProjectStore =
    hooks.writeJson ?? ((filePath, value, writeDefault) => writeDefault(filePath, value));
}

export async function createProject(options: CreateProjectOptions): Promise<ProjectOpenResult> {
  const safeName = sanitizeProjectFolderName(options.name);
  const projectPath = path.join(options.parentDirectory, `${safeName}.ether`);

  if (await exists(projectPath)) {
    const repaired = await repairPartialProject(projectPath, options.name);
    if (repaired) {
      return repaired;
    }

    throw new Error(`Project folder already exists: ${projectPath}`);
  }

  await mkdir(options.parentDirectory, { recursive: true });
  await mkdir(projectPath);
  for (const directory of REQUIRED_DIRECTORIES) {
    await mkdir(path.join(projectPath, directory), { recursive: true });
  }

  const now = new Date().toISOString();
  const metadata: ProjectMetadata = {
    id: randomUUID(),
    displayName: options.name.trim(),
    appVersion: APP_VERSION,
    createdAt: now,
    updatedAt: now,
    brandLockup: BRAND_LOCKUP,
    autosave: {
      enabled: true,
      intervalMs: 60000
    },
    providerPreferences: {},
    activeSnapshotId: null
  };
  const graph: EtherGraph = {
    graphVersion: LATEST_GRAPH_VERSION,
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    selectedSnapshotId: null,
    updatedAt: now
  };
  const paths = projectPaths(projectPath);

  await writeJson(paths.projectJson, metadata);
  await writeJson(paths.graphJson, graph);
  await writeJson(paths.linkedIndex, { references: [] });
  await writeFile(paths.runLog, "");

  const database = initializeDatabase(paths.database);

  return {
    path: projectPath,
    metadata,
    graph,
    database
  };
}

async function repairPartialProject(
  projectPath: string,
  displayName: string
): Promise<ProjectOpenResult | null> {
  try {
    const root = await stat(projectPath);

    if (!root.isDirectory()) {
      return null;
    }

    const paths = projectPaths(projectPath);

    if (await exists(paths.database)) {
      return null;
    }

    const metadata = ProjectMetadataSchema.parse(await readJson(paths.projectJson));
    const graph = normalizeEtherGraph(await readJson(paths.graphJson));

    if (metadata.displayName.trim() !== displayName.trim()) {
      return null;
    }

    for (const directory of REQUIRED_DIRECTORIES) {
      await mkdir(path.join(projectPath, directory), { recursive: true });
    }

    if (!(await exists(paths.linkedIndex))) {
      await writeJson(paths.linkedIndex, { references: [] });
    }

    if (!(await exists(paths.runLog))) {
      await writeFile(paths.runLog, "");
    }

    const database = initializeDatabase(paths.database);

    return {
      path: projectPath,
      metadata,
      graph,
      database
    };
  } catch {
    return null;
  }
}

export async function openProject(projectPath: string): Promise<ProjectOpenResult> {
  await validateProjectBundle(projectPath);
  const paths = projectPaths(projectPath);
  const metadata = ProjectMetadataSchema.parse(await readJson(paths.projectJson));
  const database = initializeDatabase(paths.database);
  const latestRevision = await getLatestGraphRevision(projectPath);

  if (latestRevision) {
    return {
      path: projectPath,
      metadata,
      graph: latestRevision.graph,
      database
    };
  }

  const graphJson = normalizeEtherGraph(await readJson(paths.graphJson));
  const graph =
    (
      await createInitialGraphRevision(projectPath, {
        graph: graphJson,
        reason: "legacy-import",
        actor: "system"
      })
    ).graph;

  return {
    path: projectPath,
    metadata,
    graph,
    database
  };
}

export type SaveGraphOptions = {
  baseRevisionId?: string | null;
  reason?: string;
  actor?: string;
  metadata?: Record<string, unknown>;
};

export type SaveGraphWithRevisionResult = {
  graph: EtherGraph;
  revision: GraphRevision;
};

export async function saveGraph(
  projectPath: string,
  graph: EtherGraphInput,
  options: SaveGraphOptions = {}
): Promise<EtherGraph> {
  return (await saveGraphWithRevision(projectPath, graph, options)).graph;
}

export async function saveGraphWithRevision(
  projectPath: string,
  graph: EtherGraphInput,
  options: SaveGraphOptions = {}
): Promise<SaveGraphWithRevisionResult> {
  const paths = projectPaths(projectPath);
  const now = new Date().toISOString();
  const nextGraph = normalizeEtherGraph({
    ...graph,
    updatedAt: now
  });
  const metadata = ProjectMetadataSchema.parse(await readJson(paths.projectJson));
  const revision = await saveGraphRevision(projectPath, {
    graph: nextGraph,
    baseRevisionId: options.baseRevisionId,
    reason: options.reason ?? "manual",
    actor: options.actor ?? "system",
    metadata: options.metadata
  });

  try {
    await writeJsonForProjectStore(paths.graphJson, revision.graph, writeJson);
  } catch {
    // graph.json is a best-effort mirror; graph revisions are the source of truth.
  }

  await writeJson(paths.projectJson, {
    ...metadata,
    updatedAt: revision.graph.updatedAt
  });

  return {
    graph: revision.graph,
    revision
  };
}

export async function loadGraph(projectPath: string): Promise<EtherGraph> {
  initializeDatabase(projectPaths(projectPath).database);
  const latestRevision = await getLatestGraphRevision(projectPath);

  if (latestRevision) {
    return latestRevision.graph;
  }

  return normalizeEtherGraph(await readJson(projectPaths(projectPath).graphJson));
}

export async function readProjectMetadata(projectPath: string): Promise<ProjectMetadata> {
  return ProjectMetadataSchema.parse(await readJson(projectPaths(projectPath).projectJson));
}

export async function writeProjectMetadata(projectPath: string, metadata: ProjectMetadata) {
  await writeJson(projectPaths(projectPath).projectJson, ProjectMetadataSchema.parse(metadata));
}

export async function validateProjectBundle(projectPath: string) {
  const root = await stat(projectPath);

  if (!root.isDirectory()) {
    throw new Error(`Project path is not a directory: ${projectPath}`);
  }

  const missing: string[] = [];

  for (const directory of REQUIRED_DIRECTORIES) {
    try {
      const directoryStat = await stat(path.join(projectPath, directory));
      if (!directoryStat.isDirectory()) {
        missing.push(directory);
      }
    } catch {
      missing.push(directory);
    }
  }

  for (const file of REQUIRED_FILES) {
    try {
      const fileStat = await stat(path.join(projectPath, file));
      if (!fileStat.isFile()) {
        missing.push(file);
      }
    } catch {
      missing.push(file);
    }
  }

  if (missing.length > 0) {
    throw new Error(`Project bundle is missing required entries: ${missing.join(", ")}`);
  }
}

export async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, "utf8")) as unknown;
}

export async function writeJson(filePath: string, value: unknown) {
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.tmp-${process.pid}-${Date.now()}-${randomUUID()}`
  );

  try {
    await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`);
    await rename(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
}

async function exists(filePath: string) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
