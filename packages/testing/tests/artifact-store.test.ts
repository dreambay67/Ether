import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  addArtifactToCollection,
  createArtifact,
  createLineageEdge,
  createProject,
  ensureCollectionFolder,
  getArtifactById,
  linkExternalReference,
  listArtifacts,
  listArtifactsByCollection,
  listAssets,
  listLineageChildren,
  listLineageParents,
  moveAssetToCollection,
  rateArtifact,
  saveGeneratedAsset,
  saveMaskAsset,
  tagArtifact,
  updateArtifactMetadata
} from "@ether/engine";

const tempRoots: string[] = [];

async function createTempRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "ether-artifact-store-"));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("artifact store", () => {
  it("creates prompt artifacts and preserves metadata updates", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Prompt Artifacts" });

    const prompt = await createArtifact(project.path, {
      kind: "prompt",
      metadata: { text: "cinematic portrait", model: "draft" },
      now: new Date("2026-06-28T10:00:00.000Z")
    });
    const updated = await updateArtifactMetadata(project.path, {
      artifactId: prompt.id,
      metadata: { model: "final", score: 9 },
      now: new Date("2026-06-28T10:01:00.000Z")
    });

    expect(prompt).toMatchObject({
      kind: "prompt",
      type: "prompt",
      metadata: { text: "cinematic portrait", model: "draft" }
    });
    expect(updated.metadata).toEqual({ text: "cinematic portrait", model: "final", score: 9 });
    await expect(getArtifactById(project.path, prompt.id)).resolves.toMatchObject({
      id: prompt.id,
      metadata: updated.metadata
    });
    await expect(listArtifacts(project.path, { kind: "prompt" })).resolves.toEqual([
      expect.objectContaining({ id: prompt.id })
    ]);
  });

  it("creates reference and image artifacts with queryable lineage", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Lineage Artifacts" });
    const referencePath = path.join(parentDirectory, "reference.png");
    await writeFile(referencePath, "reference");

    const reference = await createArtifact(project.path, {
      kind: "reference",
      path: referencePath,
      metadata: { assetId: "reference-asset-1" }
    });
    const prompt = await createArtifact(project.path, {
      kind: "prompt",
      metadata: { text: "use the reference" }
    });
    const image = await createArtifact(project.path, {
      kind: "image",
      path: path.join(project.path, "assets", "generated", "image.png"),
      parentArtifactIds: [reference.id, prompt.id],
      metadata: { assetId: "image-asset-1" }
    });
    await createLineageEdge(project.path, {
      parentArtifactId: reference.id,
      childArtifactId: prompt.id,
      edgeType: "inspired_prompt"
    });

    await expect(listLineageParents(project.path, image.id)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: reference.id, kind: "reference" }),
        expect.objectContaining({ id: prompt.id, kind: "prompt" })
      ])
    );
    await expect(listLineageChildren(project.path, reference.id)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: image.id, kind: "image" }),
        expect.objectContaining({ id: prompt.id, kind: "prompt" })
      ])
    );
  });

  it("tags, rates, and lists artifacts by collection", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Collections" });
    const collection = await ensureCollectionFolder(project.path, { name: "Hero Selects" });
    const report = await createArtifact(project.path, {
      kind: "report",
      metadata: { title: "review notes" }
    });

    await tagArtifact(project.path, { artifactId: report.id, tag: "keeper", color: "#36c" });
    const rated = await rateArtifact(project.path, {
      artifactId: report.id,
      rating: 4.5,
      note: "Strong composition",
      source: "reviewer"
    });
    await addArtifactToCollection(project.path, {
      artifactId: report.id,
      collectionId: collection.id,
      position: 2
    });

    expect(rated.metadata).toMatchObject({
      tags: ["keeper"],
      rating: { value: 4.5, note: "Strong composition", source: "reviewer" }
    });
    await expect(listArtifacts(project.path, { collectionId: collection.id })).resolves.toEqual([
      expect.objectContaining({ id: report.id })
    ]);
    await expect(listArtifactsByCollection(project.path, collection.id)).resolves.toEqual([
      expect.objectContaining({ id: report.id })
    ]);
  });

  it("searches artifacts across paths and metadata while preserving kind filters", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Artifact Search" });
    const reference = await createArtifact(project.path, {
      kind: "reference",
      path: path.join(parentDirectory, "storm-board.png"),
      metadata: { title: "Storm board", tags: ["mood"] }
    });
    await createArtifact(project.path, {
      kind: "prompt",
      metadata: { text: "quiet product table" }
    });
    const image = await createArtifact(project.path, {
      kind: "image",
      path: path.join(project.path, "assets", "generated", "hero.png"),
      metadata: { title: "Hero table render", prompt: "quiet product table" }
    });

    await expect(listArtifacts(project.path, { search: "table" })).resolves.toEqual([
      expect.objectContaining({ kind: "prompt" }),
      expect.objectContaining({ id: image.id })
    ]);
    await expect(listArtifacts(project.path, { kind: "reference", search: "storm" })).resolves.toEqual([
      expect.objectContaining({ id: reference.id })
    ]);
    await expect(listArtifacts(project.path, { kind: "image", search: "storm" })).resolves.toEqual([]);
  });

  it("dual-writes reference assets as reference artifacts", async () => {
    const parentDirectory = await createTempRoot();
    const externalDirectory = path.join(parentDirectory, "external");
    const externalReferencePath = path.join(externalDirectory, "face.png");
    const project = await createProject({ parentDirectory, name: "Dual Reference" });

    await mkdir(externalDirectory);
    await writeFile(externalReferencePath, "external image");

    const asset = await linkExternalReference(project.path, {
      filePath: externalReferencePath,
      role: "face"
    });
    const artifactId = asset.metadata.artifactId;

    expect(typeof artifactId).toBe("string");
    await expect(getArtifactById(project.path, artifactId as string)).resolves.toMatchObject({
      kind: "reference",
      path: externalReferencePath,
      metadata: expect.objectContaining({ assetId: asset.id, role: "face" })
    });
  });

  it("dual-writes generated and mask assets with lineage from parent artifact ids", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Dual Generated" });
    const prompt = await createArtifact(project.path, {
      kind: "prompt",
      metadata: { text: "blue hour city" }
    });

    const generated = await saveGeneratedAsset(project.path, {
      generationNodeId: "generation-node-1",
      fileName: "hero.png",
      content: "generated image",
      metadata: { parentArtifactIds: [prompt.id] },
      now: new Date("2026-06-28T10:00:00.000Z")
    });
    const imageArtifactId = generated.metadata.artifactId as string;

    expect(typeof imageArtifactId).toBe("string");
    await expect(getArtifactById(project.path, imageArtifactId)).resolves.toMatchObject({
      kind: "image",
      path: generated.path,
      metadata: expect.objectContaining({ assetId: generated.id })
    });
    await expect(listLineageChildren(project.path, prompt.id)).resolves.toEqual([
      expect.objectContaining({ id: imageArtifactId, kind: "image" })
    ]);

    const mask = await saveMaskAsset(project.path, {
      editNodeId: "edit-node-1",
      sourceAssetId: generated.id,
      sourceAssetPath: generated.path,
      fileName: "hero-mask.svg",
      content: "<svg xmlns=\"http://www.w3.org/2000/svg\" />",
      metadata: { sourceArtifactId: imageArtifactId },
      now: new Date("2026-06-28T10:02:00.000Z")
    });
    const maskArtifactId = mask.metadata.artifactId as string;

    expect(typeof maskArtifactId).toBe("string");
    await expect(getArtifactById(project.path, maskArtifactId)).resolves.toMatchObject({
      kind: "mask",
      path: mask.path,
      metadata: expect.objectContaining({ assetId: mask.id, sourceAssetId: generated.id })
    });
    await expect(listLineageParents(project.path, maskArtifactId)).resolves.toEqual([
      expect.objectContaining({ id: imageArtifactId, kind: "image" })
    ]);
  });

  it("rolls back generated asset DB rows when artifact lineage insert rejects", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Atomic Generated" });
    const expectedOutputPath = path.join(
      project.path,
      "assets",
      "generated",
      "2026",
      "06",
      "generation-node-1",
      "orphan.png"
    );

    await expect(
      saveGeneratedAsset(project.path, {
        generationNodeId: "generation-node-1",
        fileName: "orphan.png",
        content: "generated image",
        metadata: { parentArtifactIds: ["missing-artifact"] },
        now: new Date("2026-06-28T10:00:00.000Z")
      })
    ).rejects.toThrow(/foreign key/i);

    await expect(listAssets(project.path, { kind: "generated" })).resolves.toEqual([]);
    await expect(listArtifacts(project.path, { kind: "image" })).resolves.toEqual([]);
    await expect(access(expectedOutputPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps generated artifact records in sync when moving assets into collections", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Move Artifact Collection" });
    const collection = await ensureCollectionFolder(project.path, {
      name: "Approved",
      now: new Date("2026-06-28T10:01:00.000Z")
    });
    const generated = await saveGeneratedAsset(project.path, {
      generationNodeId: "generation-node-1",
      fileName: "hero.png",
      content: "generated image",
      metadata: { prompt: "hero table" },
      now: new Date("2026-06-28T10:00:00.000Z")
    });
    const artifactId = generated.metadata.artifactId as string;

    const moved = await moveAssetToCollection(project.path, {
      assetId: generated.id,
      collectionId: collection.id,
      reason: "approved",
      now: new Date("2026-06-28T10:02:00.000Z")
    });

    await expect(getArtifactById(project.path, artifactId)).resolves.toMatchObject({
      id: artifactId,
      path: moved.path,
      metadata: expect.objectContaining({
        assetId: generated.id,
        assetPath: moved.path,
        collectionId: collection.id,
        movedFromPath: generated.path
      })
    });
    await expect(listArtifactsByCollection(project.path, collection.id)).resolves.toEqual([
      expect.objectContaining({ id: artifactId, path: moved.path })
    ]);
  });

  it("reuses duplicate lineage edges", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Idempotent Lineage" });
    const parent = await createArtifact(project.path, { kind: "prompt", metadata: { text: "parent" } });
    const child = await createArtifact(project.path, { kind: "image", metadata: { label: "child" } });

    const first = await createLineageEdge(project.path, {
      parentArtifactId: parent.id,
      childArtifactId: child.id,
      edgeType: "derived_from"
    });
    const second = await createLineageEdge(project.path, {
      parentArtifactId: parent.id,
      childArtifactId: child.id,
      edgeType: "derived_from"
    });

    expect(second.id).toBe(first.id);
    await expect(listLineageChildren(project.path, parent.id)).resolves.toEqual([
      expect.objectContaining({ id: child.id })
    ]);
  });

  it("updates duplicate collection memberships instead of listing duplicates", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Idempotent Collection" });
    const collection = await ensureCollectionFolder(project.path, { name: "Ranked Selects" });
    const first = await createArtifact(project.path, { kind: "image", metadata: { label: "first" } });
    const second = await createArtifact(project.path, { kind: "image", metadata: { label: "second" } });

    await addArtifactToCollection(project.path, {
      artifactId: first.id,
      collectionId: collection.id,
      position: 1,
      metadata: { note: "initial" }
    });
    await addArtifactToCollection(project.path, {
      artifactId: second.id,
      collectionId: collection.id,
      position: 2
    });
    await addArtifactToCollection(project.path, {
      artifactId: first.id,
      collectionId: collection.id,
      position: 3,
      metadata: { note: "updated" }
    });

    await expect(listArtifactsByCollection(project.path, collection.id)).resolves.toEqual([
      expect.objectContaining({ id: second.id }),
      expect.objectContaining({ id: first.id })
    ]);
  });

  it("extracts generated asset lineage from nested execution-style metadata", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Nested Lineage" });
    const prompt = await createArtifact(project.path, {
      kind: "prompt",
      metadata: { text: "nested source" }
    });

    const generated = await saveGeneratedAsset(project.path, {
      generationNodeId: "generation-node-1",
      fileName: "nested.png",
      content: "generated image",
      metadata: { sourceAssetMetadata: { artifactId: prompt.id } },
      lineage: { parent: { assetMetadata: { artifactId: prompt.id } } },
      now: new Date("2026-06-28T10:00:00.000Z")
    });

    await expect(listLineageParents(project.path, generated.metadata.artifactId as string)).resolves.toEqual([
      expect.objectContaining({ id: prompt.id, kind: "prompt" })
    ]);
  });

  it("deep-merges mask artifact metadata updates without losing workspace drawing details", async () => {
    const parentDirectory = await createTempRoot();
    const project = await createProject({ parentDirectory, name: "Mask Metadata Preservation" });
    const sourcePath = path.join(project.path, "assets", "generated", "source.png");
    const mask = await createArtifact(project.path, {
      kind: "mask",
      path: path.join(project.path, "assets", "masks", "edit", "mask.svg"),
      metadata: {
        brush: { tool: "brush", size: 34, opacity: 0.7 },
        recipe: { id: "product-cleanup", label: "Product clean-up" },
        frame: {
          mode: "outpaint",
          x: -24,
          y: 12,
          width: 1180,
          height: 900,
          canvasWidth: 1024,
          canvasHeight: 768
        },
        source: {
          assetId: "source-asset-1",
          assetPath: sourcePath,
          artifactId: "source-artifact-1"
        }
      }
    });

    const updated = await updateArtifactMetadata(project.path, {
      artifactId: mask.id,
      metadata: {
        brush: { tool: "eraser" },
        frame: { width: 1200 },
        source: { nodeId: "source-node" }
      }
    });

    expect(updated.metadata).toMatchObject({
      brush: { tool: "eraser", size: 34, opacity: 0.7 },
      recipe: { id: "product-cleanup", label: "Product clean-up" },
      frame: {
        mode: "outpaint",
        x: -24,
        y: 12,
        width: 1200,
        height: 900,
        canvasWidth: 1024,
        canvasHeight: 768
      },
      source: {
        assetId: "source-asset-1",
        assetPath: sourcePath,
        artifactId: "source-artifact-1",
        nodeId: "source-node"
      }
    });
  });
});
