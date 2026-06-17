import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "../../../packages/engine/node_modules/better-sqlite3";
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
import * as engine from "@ether/engine";

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
  it("saves mask overlays under assets/masks and lists them as first-class assets", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Mask Overlay" });
    const saveMaskAsset = (
      engine as typeof engine & {
        saveMaskAsset: (projectPath: string, options: {
          editNodeId: string;
          sourceAssetId: string;
          sourceAssetPath: string;
          fileName: string;
          content: string;
          mimeType: string;
          metadata: Record<string, unknown>;
          now: Date;
        }) => Promise<Awaited<ReturnType<typeof saveGeneratedAsset>>>;
      }
    ).saveMaskAsset;

    expect(typeof saveMaskAsset).toBe("function");

    const mask = await saveMaskAsset(project.path, {
      editNodeId: "edit-node-1",
      sourceAssetId: "generated-parent-1",
      sourceAssetPath: path.join(project.path, "assets", "generated", "parent.svg"),
      fileName: "..\\unsafe mask.svg",
      content: "<svg xmlns=\"http://www.w3.org/2000/svg\"><rect width=\"10\" height=\"10\" /></svg>",
      mimeType: "image/svg+xml",
      metadata: { label: "face repair" },
      now: new Date("2026-06-17T12:30:00.000Z")
    });

    expect(mask).toMatchObject({
      kind: "mask",
      path: path.join(
        project.path,
        "assets",
        "masks",
        "2026",
        "06",
        "edit-node-1",
        "unsafe mask.svg"
      ),
      metadata: {
        editNodeId: "edit-node-1",
        sourceAssetId: "generated-parent-1",
        sourceAssetPath: path.join(project.path, "assets", "generated", "parent.svg"),
        originalName: "unsafe mask.svg",
        mimeType: "image/svg+xml",
        label: "face repair",
        lineage: {
          kind: "mask",
          editNodeId: "edit-node-1",
          sourceAssetId: "generated-parent-1"
        }
      }
    });
    await expect(readFile(mask.path, "utf8")).resolves.toContain("<rect");
    await expect(listAssets(project.path, { kind: "mask" as any })).resolves.toEqual([
      expect.objectContaining({ id: mask.id, path: mask.path, kind: "mask" })
    ]);
  });

  it("rejects mask saves when the masks directory resolves outside the project", async () => {
    const parentDirectory = await createTempRoot();
    const outsideMasksDirectory = path.join(parentDirectory, "outside-masks");
    const project = await createProject({ parentDirectory, name: "Linked Masks Root" });
    const masksDirectory = path.join(project.path, "assets", "masks");
    const saveMaskAsset = (
      engine as typeof engine & {
        saveMaskAsset: (projectPath: string, options: {
          editNodeId: string;
          sourceAssetId: string;
          sourceAssetPath: string;
          fileName: string;
          content: string;
          mimeType: string;
          now: Date;
        }) => Promise<Awaited<ReturnType<typeof saveGeneratedAsset>>>;
      }
    ).saveMaskAsset;

    await mkdir(outsideMasksDirectory);
    await rm(masksDirectory, { recursive: true, force: true });

    try {
      await symlink(outsideMasksDirectory, masksDirectory, "junction");
    } catch {
      return;
    }

    await expect(
      saveMaskAsset(project.path, {
        editNodeId: "edit-node-1",
        sourceAssetId: "generated-parent-1",
        sourceAssetPath: path.join(project.path, "assets", "generated", "parent.svg"),
        fileName: "escaped-mask.svg",
        content: "<svg xmlns=\"http://www.w3.org/2000/svg\"><title>escaped</title></svg>",
        mimeType: "image/svg+xml",
        now: new Date("2026-06-17T12:30:00.000Z")
      })
    ).rejects.toThrow("Mask asset path must stay inside the project masks directory.");

    await expect(
      readFile(
        path.join(outsideMasksDirectory, "2026", "06", "edit-node-1", "escaped-mask.svg"),
        "utf8"
      )
    ).rejects.toThrow();
  });

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

  it("preserves all linked-index entries from concurrent external reference links", async () => {
    const parentDirectory = await createTempRoot();
    const externalDirectory = path.join(parentDirectory, "external-concurrent");
    const project = await createProject({ parentDirectory, name: "Concurrent References" });
    const referencePaths = Array.from({ length: 16 }, (_value, index) =>
      path.join(externalDirectory, `reference-${index}.png`)
    );

    await mkdir(externalDirectory);
    await Promise.all(
      referencePaths.map((referencePath, index) => writeFile(referencePath, `reference ${index}`))
    );

    const assets = await Promise.all(
      referencePaths.map((referencePath) => linkExternalReference(project.path, { filePath: referencePath }))
    );
    const linkedIndex = JSON.parse(
      await readFile(path.join(project.path, "assets", "references", "linked-index.json"), "utf8")
    ) as { references: Array<{ id: string; path: string }> };

    expect(linkedIndex.references.map((reference) => reference.id).sort()).toEqual(
      assets.map((asset) => asset.id).sort()
    );
    expect(linkedIndex.references.map((reference) => reference.path).sort()).toEqual(
      referencePaths.sort()
    );
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

  it("moves concurrent generated assets with the same basename into distinct collection files", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Concurrent Collection Moves" });
    const first = await saveGeneratedAsset(project.path, {
      generationNodeId: "generation-node-1",
      fileName: "keeper.png",
      content: "first keeper",
      now: new Date("2026-06-17T12:00:00.000Z")
    });
    const second = await saveGeneratedAsset(project.path, {
      generationNodeId: "generation-node-2",
      fileName: "keeper.png",
      content: "second keeper",
      now: new Date("2026-06-17T12:00:00.000Z")
    });
    const collection = await ensureCollectionFolder(project.path, { name: "Concurrent Keepers" });

    const moved = await Promise.all(
      [first, second].map((asset) =>
        moveAssetToCollection(project.path, {
          assetId: asset.id,
          collectionId: collection.id,
          reason: "concurrent-move"
        })
      )
    );
    const movedContents = await Promise.all(moved.map((asset) => readFile(asset.path, "utf8")));

    expect(new Set(moved.map((asset) => asset.path)).size).toBe(2);
    expect(moved.map((asset) => path.dirname(asset.path))).toEqual([collection.path, collection.path]);
    expect(movedContents.sort()).toEqual(["first keeper", "second keeper"]);
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

  it("moves a generated asset back to its original path when audit insert fails", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Move Rollback" });
    const generated = await saveGeneratedAsset(project.path, {
      generationNodeId: "generation-node-1",
      fileName: "rollback.png",
      content: "rollback image",
      now: new Date("2026-06-17T12:00:00.000Z")
    });
    const collection = await ensureCollectionFolder(project.path, { name: "Rejected" });
    const destinationPath = path.join(collection.path, "rollback.png");
    const db = new Database(path.join(project.path, "ether.db"));

    try {
      db.exec(`
        CREATE TRIGGER fail_asset_move_insert
        BEFORE INSERT ON asset_moves
        BEGIN
          SELECT RAISE(FAIL, 'audit insert failed');
        END;
      `);
    } finally {
      db.close();
    }

    await expect(
      moveAssetToCollection(project.path, {
        assetId: generated.id,
        collectionId: collection.id,
        reason: "force-audit-failure"
      })
    ).rejects.toThrow("audit insert failed");

    await expect(readFile(generated.path, "utf8")).resolves.toBe("rollback image");
    await expect(readFile(destinationPath, "utf8")).rejects.toThrow();
    await expect(listAssets(project.path, { kind: "generated" })).resolves.toEqual([
      expect.objectContaining({ id: generated.id, path: generated.path })
    ]);
    await expect(listAssetMoves(project.path, { assetId: generated.id })).resolves.toEqual([]);
  });

  it("rejects collection asset paths outside the project collections directory", async () => {
    const parentDirectory = await createTempRoot();
    const outsideDirectory = path.join(parentDirectory, "outside-collection");
    const project = await createProject({ parentDirectory, name: "Outside Collection" });
    const generated = await saveGeneratedAsset(project.path, {
      generationNodeId: "generation-node-1",
      fileName: "outside.png",
      content: "outside guard",
      now: new Date("2026-06-17T12:00:00.000Z")
    });
    const collection = await ensureCollectionFolder(project.path, { name: "Corrupt Collection" });
    const db = new Database(path.join(project.path, "ether.db"));

    try {
      db.prepare("UPDATE assets SET path = ? WHERE id = ?").run(outsideDirectory, collection.id);
    } finally {
      db.close();
    }

    await expect(
      moveAssetToCollection(project.path, {
        assetId: generated.id,
        collectionId: collection.id
      })
    ).rejects.toThrow("Collection path must stay inside the project collections directory.");

    await expect(readFile(generated.path, "utf8")).resolves.toBe("outside guard");
  });

  it("rejects collection folders that resolve outside the project through a junction", async () => {
    const parentDirectory = await createTempRoot();
    const outsideDirectory = path.join(parentDirectory, "outside-junction-target");
    const project = await createProject({ parentDirectory, name: "Linked Collection" });
    const generated = await saveGeneratedAsset(project.path, {
      generationNodeId: "generation-node-1",
      fileName: "linked.png",
      content: "linked guard",
      now: new Date("2026-06-17T12:00:00.000Z")
    });
    const collection = await ensureCollectionFolder(project.path, { name: "Linked Collection" });

    await mkdir(outsideDirectory);
    await rm(collection.path, { recursive: true, force: true });

    try {
      await symlink(outsideDirectory, collection.path, "junction");
    } catch {
      return;
    }

    await expect(
      moveAssetToCollection(project.path, {
        assetId: generated.id,
        collectionId: collection.id
      })
    ).rejects.toThrow("Collection path must stay inside the project collections directory.");

    await expect(readFile(generated.path, "utf8")).resolves.toBe("linked guard");
  });

  it("rejects collection moves when the project collections root resolves outside the project", async () => {
    const parentDirectory = await createTempRoot();
    const outsideCollectionsDirectory = path.join(parentDirectory, "outside-collections-root");
    const project = await createProject({ parentDirectory, name: "Linked Collections Root" });
    const collectionsDirectory = path.join(project.path, "collections");
    const generated = await saveGeneratedAsset(project.path, {
      generationNodeId: "generation-node-1",
      fileName: "root-linked.png",
      content: "root linked guard",
      now: new Date("2026-06-17T12:00:00.000Z")
    });

    await mkdir(outsideCollectionsDirectory);
    await rm(collectionsDirectory, { recursive: true, force: true });

    try {
      await symlink(outsideCollectionsDirectory, collectionsDirectory, "junction");
    } catch {
      return;
    }

    const collection = await ensureCollectionFolder(project.path, { name: "Root Linked Collection" });

    await expect(
      moveAssetToCollection(project.path, {
        assetId: generated.id,
        collectionId: collection.id
      })
    ).rejects.toThrow("Collection path must stay inside the project collections directory.");

    await expect(readFile(generated.path, "utf8")).resolves.toBe("root linked guard");
  });

  it("allocates generated output paths uniquely under concurrent saves", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Concurrent Generated" });
    const now = new Date("2026-06-17T12:00:00.000Z");

    const assets = await Promise.all(
      Array.from({ length: 8 }, (_value, index) =>
        saveGeneratedAsset(project.path, {
          generationNodeId: "generation-node-1",
          fileName: "parallel.png",
          content: `parallel image ${index}`,
          now
        })
      )
    );

    expect(new Set(assets.map((asset) => asset.path)).size).toBe(assets.length);
    await expect(readdir(path.dirname(assets[0]!.path))).resolves.toHaveLength(assets.length);
  });
});
