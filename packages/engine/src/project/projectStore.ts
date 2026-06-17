import { constants } from "node:fs";
import { access, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { initializeDatabase } from "./database.js";
import { projectPaths, REQUIRED_DIRECTORIES, REQUIRED_FILES, sanitizeProjectFolderName } from "./paths.js";
import {
  EtherGraphSchema,
  ProjectMetadataSchema,
  type CreateProjectOptions,
  type EtherGraph,
  type ProjectMetadata,
  type ProjectOpenResult
} from "./schema.js";

const APP_VERSION = "0.1.0";
const BRAND_LOCKUP = "ETHER by DreamBay";

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
    const graph = EtherGraphSchema.parse(await readJson(paths.graphJson));

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
  const graph = EtherGraphSchema.parse(await readJson(paths.graphJson));
  const database = initializeDatabase(paths.database);

  return {
    path: projectPath,
    metadata,
    graph,
    database
  };
}

export async function saveGraph(projectPath: string, graph: EtherGraph): Promise<EtherGraph> {
  const paths = projectPaths(projectPath);
  const now = new Date().toISOString();
  const nextGraph = EtherGraphSchema.parse({
    ...graph,
    updatedAt: now
  });
  const metadata = ProjectMetadataSchema.parse(await readJson(paths.projectJson));

  await writeJson(paths.graphJson, nextGraph);
  await writeJson(paths.projectJson, {
    ...metadata,
    updatedAt: now
  });

  return nextGraph;
}

export async function loadGraph(projectPath: string): Promise<EtherGraph> {
  return EtherGraphSchema.parse(await readJson(projectPaths(projectPath).graphJson));
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
