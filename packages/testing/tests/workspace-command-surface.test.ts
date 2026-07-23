import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

interface PackageManifest {
  name?: string;
  scripts?: Record<string, string>;
}

const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
const workspaceRoots = ["apps", "packages"];

async function readManifest(relativePath: string): Promise<PackageManifest> {
  const contents = await readFile(path.join(repositoryRoot, relativePath), "utf8");
  return JSON.parse(contents) as PackageManifest;
}

async function findWorkspaceManifests(): Promise<string[]> {
  const manifests: string[] = [];

  for (const workspaceRoot of workspaceRoots) {
    const entries = await readdir(path.join(repositoryRoot, workspaceRoot), {
      withFileTypes: true
    });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const manifestPath = path.join(workspaceRoot, entry.name, "package.json");
        try {
          await access(path.join(repositoryRoot, manifestPath));
          manifests.push(manifestPath);
        } catch {
          // Empty or retired package directories are not workspace members.
        }
      }
    }
  }

  return manifests.sort();
}

function isTestSuiteCatalog(value: unknown): value is Record<string, readonly string[]> {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.values(value).every(
      (entries) => Array.isArray(entries) && entries.every((entry) => typeof entry === "string")
    )
  );
}

describe("workspace command surface", () => {
  it("exposes every required root quality gate", async () => {
    const manifest = await readManifest("package.json");

    expect(manifest.scripts).toMatchObject({
      typecheck: "pnpm -r typecheck",
      lint: "eslint . --max-warnings=0",
      "test:integration": "pnpm --filter @ether/testing test:integration",
      "test:packaged": "pnpm --filter @ether/testing test:packaged",
      "test:performance": "pnpm --filter @ether/testing test:performance",
      "test:conformance:codex": "pnpm --filter @ether/testing test:conformance:codex",
      "test:conformance:antigravity":
        "pnpm --filter @ether/testing test:conformance:antigravity"
    });
  });

  it("requires typecheck and lint gates from every workspace", async () => {
    const missingGates: string[] = [];

    for (const manifestPath of await findWorkspaceManifests()) {
      const manifest = await readManifest(manifestPath);
      for (const gate of ["typecheck", "lint"] as const) {
        if (!manifest.scripts?.[gate]) {
          missingGates.push(`${manifest.name ?? manifestPath}: ${gate}`);
        }
      }
    }

    expect(missingGates).toEqual([]);
  });

  it("runs strict Electron and renderer typechecks for the desktop", async () => {
    const manifest = await readManifest("apps/desktop/package.json");

    expect(manifest.scripts?.typecheck).toBe(
      "tsc -p tsconfig.electron.json && tsc -p tsconfig.preload.json && tsc -p tsconfig.renderer.json"
    );
    await expect(
      access(path.join(repositoryRoot, "apps/desktop/tsconfig.electron.json"))
    ).resolves.toBeUndefined();
    await expect(
      access(path.join(repositoryRoot, "apps/desktop/tsconfig.renderer.json"))
    ).resolves.toBeUndefined();
    await expect(
      access(path.join(repositoryRoot, "apps/desktop/tsconfig.preload.json"))
    ).resolves.toBeUndefined();
  });

  it("exposes distinct test category entrypoints", async () => {
    const manifest = await readManifest("packages/testing/package.json");

    expect(manifest.scripts).toMatchObject({
      "test:unit": "vitest run --config vitest.config.ts",
      "test:integration": "vitest run --config vitest.integration.config.ts",
      "test:performance": "vitest run --config vitest.performance.config.ts"
    });
    expect(manifest.scripts?.["test:contracts"]).toContain("vitest run");
    await expect(
      access(path.join(repositoryRoot, "packages/testing/vitest.integration.config.ts"))
    ).resolves.toBeUndefined();
    await expect(
      access(path.join(repositoryRoot, "packages/testing/vitest.performance.config.ts"))
    ).resolves.toBeUndefined();
  });

  it("assigns every runnable test source to exactly one existing suite target", async () => {
    const catalogPath = path.join(repositoryRoot, "packages/testing/testSuites.ts");
    const catalogModule: unknown = await import(pathToFileURL(catalogPath).href);
    const testSuites =
      typeof catalogModule === "object" && catalogModule !== null && "testSuites" in catalogModule
        ? catalogModule.testSuites
        : undefined;

    expect(isTestSuiteCatalog(testSuites)).toBe(true);
    if (!isTestSuiteCatalog(testSuites)) {
      return;
    }

    const assignments = new Map<string, string[]>();
    for (const [suite, targets] of Object.entries(testSuites)) {
      for (const target of targets) {
        assignments.set(target, [...(assignments.get(target) ?? []), suite]);
        await expect(access(path.join(repositoryRoot, "packages/testing", target))).resolves.toBeUndefined();
      }
    }

    const runnableSources = (await readdir(path.join(repositoryRoot, "packages/testing/tests"), {
      recursive: true
    }))
      .filter((entry) => /\.(?:test|spec|packaged|conformance)\.ts$/.test(entry))
      .map((entry) => `tests/${entry.replaceAll("\\", "/")}`)
      .sort();

    expect([...assignments.keys()].sort()).toEqual(runnableSources);
    expect(
      [...assignments.entries()]
        .filter(([, suites]) => suites.length !== 1)
        .map(([target, suites]) => `${target}: ${suites.join(", ")}`)
    ).toEqual([]);
  });

  it("keeps the fast unit runner bound to the catalog's unit assignment", async () => {
    const unitConfig = await readFile(
      path.join(repositoryRoot, "packages/testing/vitest.config.ts"),
      "utf8"
    );

    expect(unitConfig).toContain("include: [...testSuites.unit]");
    expect(unitConfig).not.toContain("testSuites.performance");
  });

  it("keeps the aggregate test command comprehensive after splitting suites", async () => {
    const manifest = await readManifest("package.json");

    expect(manifest.scripts?.test).toContain("pnpm run test:unit");
    expect(manifest.scripts?.test).toContain("pnpm run test:integration");
    expect(manifest.scripts?.test).toContain("pnpm --filter @ether/testing test:contracts");
    expect(manifest.scripts?.test).toContain("pnpm run test:smoke");
  });
});
