import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createProject,
  ensureCollectionFolder,
  ensureDirectoryRoot,
  linkExternalReference,
  listAssetMoves,
  listAssets,
  moveAssetToCollection,
  saveGeneratedAsset
} from "@ether/engine";

const tempRoots: string[] = [];

async function createTempRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "ether-assets-"));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("asset service", () => {
  it("links an external reference without copying it and records the linked index", async () => {
    const parentDirectory = await createTempRoot();
    const externalDirectory = path.join(parentDirectory, "external");
    const externalReferencePath = path.join(externalDirectory, "Hero Face.PNG");
    const project = await createProject({ parentDirectory, name: "Linked References" });

    await mkdir(externalDirectory);
    await writeFile(externalReferencePath, "external image");

    const asset = await linkExternalReference(project.path, {
      filePath: externalReferencePath,
      role: "face"
    });

    expect(asset).toMatchObject({
      kind: "reference",
      path: externalReferencePath,
      metadata: {
        role: "face",
        linkMode: "linked",
        originalName: "Hero Face.PNG",
        mimeType: "image/png"
      }
    });
    expect(asset.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );

    const linkedIndex = JSON.parse(
      await readFile(path.join(project.path, "assets", "references", "linked-index.json"), "utf8")
    ) as { references: Array<{ id: string; path: string; linkedAt?: string }> };

    expect(linkedIndex.references).toEqual([
      expect.objectContaining({
        id: asset.id,
        path: externalReferencePath
      })
    ]);
    expect(new Date(linkedIndex.references[0]?.linkedAt ?? "").toString()).not.toBe("Invalid Date");
    expect(await readdir(path.join(project.path, "assets", "references"))).toEqual(["linked-index.json"]);
    await expect(readFile(externalReferencePath, "utf8")).resolves.toBe("external image");
    await expect(listAssets(project.path, { kind: "reference" })).resolves.toEqual([
      expect.objectContaining({ id: asset.id, path: externalReferencePath })
    ]);
  });

  it("saves generated output under a dated generation-node directory and records lineage", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Generated Output" });

    const asset = await saveGeneratedAsset(project.path, {
      generationNodeId: "generation-node-1",
      fileName: "hero-output.png",
      content: Buffer.from("fake generated image"),
      mimeType: "image/png",
      lineage: { promptNodeId: "prompt-1" },
      now: new Date("2026-06-17T12:00:00.000Z")
    });

    expect(asset).toMatchObject({
      kind: "generated",
      path: path.join(
        project.path,
        "assets",
        "generated",
        "2026",
        "06",
        "generation-node-1",
        "hero-output.png"
      ),
      metadata: {
        generationNodeId: "generation-node-1",
        originalName: "hero-output.png",
        mimeType: "image/png",
        lineage: { promptNodeId: "prompt-1" }
      }
    });
    await expect(readFile(asset.path, "utf8")).resolves.toBe("fake generated image");
    await expect(listAssets(project.path, { kind: "generated" })).resolves.toEqual([
      expect.objectContaining({ id: asset.id, path: asset.path })
    ]);
  });

  it("ensures collection and directory folders and returns stable records on repeat", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Store Nodes" });

    const collection = await ensureCollectionFolder(project.path, {
      name: "Hero Selects",
      nodeId: "collection-node-1"
    });
    const repeatedCollection = await ensureCollectionFolder(project.path, {
      name: "Hero Selects",
      nodeId: "collection-node-1"
    });
    const directory = await ensureDirectoryRoot(project.path, {
      name: "Client Stream",
      nodeId: "directory-node-1"
    });

    expect(collection).toMatchObject({
      kind: "collection",
      path: path.join(project.path, "collections", "Hero Selects"),
      metadata: {
        displayName: "Hero Selects",
        safeName: "Hero Selects",
        nodeId: "collection-node-1"
      }
    });
    expect(repeatedCollection.id).toBe(collection.id);
    expect(directory).toMatchObject({
      kind: "directory",
      path: path.join(project.path, "directories", "Client Stream"),
      metadata: {
        displayName: "Client Stream",
        safeName: "Client Stream",
        nodeId: "directory-node-1"
      }
    });
    await expect(stat(collection.path)).resolves.toSatisfy((stats) => stats.isDirectory());
    await expect(stat(directory.path)).resolves.toSatisfy((stats) => stats.isDirectory());
  });

  it("moves a generated asset into a collection and writes an audit row", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Audited Moves" });
    const generated = await saveGeneratedAsset(project.path, {
      generationNodeId: "generation-node-1",
      fileName: "keeper.png",
      content: "keeper image",
      now: new Date("2026-06-17T12:00:00.000Z")
    });
    const collection = await ensureCollectionFolder(project.path, { name: "Keepers" });

    const moved = await moveAssetToCollection(project.path, {
      assetId: generated.id,
      collectionId: collection.id,
      reason: "filter-accepted"
    });

    expect(moved).toMatchObject({
      id: generated.id,
      kind: "generated",
      path: path.join(collection.path, "keeper.png")
    });
    await expect(readFile(moved.path, "utf8")).resolves.toBe("keeper image");
    await expect(readFile(generated.path, "utf8")).rejects.toThrow();
    await expect(listAssets(project.path, { kind: "generated" })).resolves.toEqual([
      expect.objectContaining({ id: generated.id, path: moved.path })
    ]);
    await expect(listAssetMoves(project.path, { assetId: generated.id })).resolves.toEqual([
      expect.objectContaining({
        assetId: generated.id,
        fromPath: generated.path,
        toPath: moved.path,
        reason: "filter-accepted"
      })
    ]);
  });

  it("refuses to move external linked references by default", async () => {
    const parentDirectory = await createTempRoot();
    const externalReferencePath = path.join(parentDirectory, "external-reference.png");
    const project = await createProject({ parentDirectory, name: "Reference Move Guard" });
    await writeFile(externalReferencePath, "external image");
    const reference = await linkExternalReference(project.path, { filePath: externalReferencePath });
    const collection = await ensureCollectionFolder(project.path, { name: "Keepers" });

    await expect(
      moveAssetToCollection(project.path, {
        assetId: reference.id,
        collectionId: collection.id,
        reason: "manual"
      })
    ).rejects.toThrow("Linked references are not moved by default.");

    await expect(readFile(externalReferencePath, "utf8")).resolves.toBe("external image");
    await expect(listAssets(project.path, { kind: "reference" })).resolves.toEqual([
      expect.objectContaining({ id: reference.id, path: externalReferencePath })
    ]);
    await expect(listAssetMoves(project.path, { assetId: reference.id })).resolves.toEqual([]);
  });
});
