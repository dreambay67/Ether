import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { inflateSync } from "node:zlib";
import os from "node:os";
import path from "node:path";

import { EtherApplication, transcodeArtifactForExport } from "@ether/application";
import { importBlob } from "@ether/document";
import { createSharpLocalMediaFacet } from "@ether/execution";
import { FakeImageProvider } from "@ether/providers";
import type { Artifact, EtherGraph, NodeOutputVersion, PayloadEnvelope } from "@ether/schema";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
const applications: EtherApplication[] = [];
const at = "2026-08-03T08:00:00.000Z";

afterEach(async () => {
  await Promise.all(applications.splice(0).map(async (app) => {
    try { await app.closeDocument(); } catch { /* the test may have already closed it */ }
  }));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("deterministic local media runtime", () => {
  it("renders staged image and workspace mask inputs locally, preserves lineage, and fails closed without a source", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ether-local-media-runtime-"));
    roots.push(root);
    const resolverExecutors: string[] = [];
    const app = new EtherApplication({
      appDataRoot: root,
      appVersion: "4.0.0-test",
      provider: new FakeImageProvider(),
      providerResolver: async ({ step }) => {
        resolverExecutors.push(step.executor);
        return {};
      }
    });
    applications.push(app);
    await app.createDocument({
      path: path.join(root, "Local media.ether"),
      title: "Local media",
      initialGraph: graph()
    });

    const sourceSvg = Buffer.from([
      '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="2">',
      '<rect width="4" height="2" fill="#1866d8"/>',
      '<rect x="0" y="0" width="1" height="1" fill="#f7d64a"/>',
      "</svg>"
    ].join(""));
    const sourceBytes = await transcodeArtifactForExport(sourceSvg, "image/svg+xml", "png");
    const sourcePath = path.join(root, "source.png");
    await writeFile(sourcePath, sourceBytes);
    const blob = await importBlob(
      app.boundaryStore(),
      { sourcePath, mediaType: "image/png" },
      { appDataRoot: root }
    );
    await insertSource(app, blob.contentKey, sourceBytes.byteLength);

    const resizeJob = await start(app, "resize");
    expect(resizeJob.status).toBe("completed");
    const resize = await completedOutput(app, "resize", resizeJob.id);
    const resizedBytes = await app.readArtifactBytes(resize.artifact.id);
    expect(png(resizedBytes)).toMatchObject({ width: 6, height: 4 });
    expect(resizedBytes).not.toEqual(sourceBytes);
    expect(resize.version).toMatchObject({
      producer: { kind: "local", executor: "transform" },
      inputPayloadIds: ["source-payload"],
      selectedOutputVersionIds: ["source-output"]
    });
    expect(resize.artifact).toMatchObject({
      channel: "image",
      mediaType: "image/png",
      source: { outputVersionId: resize.version.id, payloadId: resize.payload.id },
      metadata: {
        localMediaOperation: "resize",
        sourcePayloadId: "source-payload",
        sourceArtifactId: "source-artifact",
        width: 6,
        height: 4
      }
    });

    const maskJob = await start(app, "mask");
    expect(maskJob.status).toBe("completed");
    const mask = await completedOutput(app, "mask", maskJob.id);
    const maskBytes = await app.readArtifactBytes(mask.artifact.id);
    const decodedMask = png(maskBytes);
    expect(decodedMask).toMatchObject({ width: 4, height: 2 });
    expect(Math.min(...decodedMask.pixels)).toBeLessThan(10);
    expect(Math.max(...decodedMask.pixels)).toBeGreaterThan(245);
    expect(mask.version).toMatchObject({
      producer: { kind: "local", executor: "mask" },
      inputPayloadIds: ["source-payload"],
      selectedOutputVersionIds: ["source-output"]
    });
    expect(mask.artifact).toMatchObject({
      channel: "mask",
      mediaType: "image/png",
      metadata: {
        localMediaOperation: "mask",
        sourcePayloadId: "source-payload",
        sourceArtifactId: "source-artifact",
        workspaceMaskStrokeCount: 2,
        width: 4,
        height: 2
      }
    });

    const missingJob = await start(app, "missing");
    expect(missingJob.status).toBe("failed");
    expect(await app.queryAttempts(missingJob.id)).toEqual([
      expect.objectContaining({ status: "failed", failure: expect.objectContaining({ code: "LOCAL_MEDIA_SOURCE_REQUIRED" }) })
    ]);
    expect(resolverExecutors).toEqual(expect.arrayContaining(["transform", "mask"]));
    await app.closeDocument();
  });

  it("accepts a logical Reference Set image staged inside the attempt and rejects an escape path", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ether-local-media-reference-"));
    roots.push(root);
    const stagingDirectory = path.join(root, "attempt");
    await mkdir(stagingDirectory, { recursive: true });
    const sourcePath = path.join(stagingDirectory, "reference.png");
    const source = await transcodeArtifactForExport(
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="1"><rect width="2" height="1" fill="#44aa88"/></svg>'),
      "image/svg+xml",
      "png"
    );
    await writeFile(sourcePath, source);
    const referenceInput: PayloadEnvelope = {
      id: "reference-image-payload",
      channel: "image",
      role: "subject",
      content: { kind: "object", value: { referenceId: "reference-1" }, schemaId: "ether.reference-input.v1" },
      source: { nodeId: "references", outputVersionId: "reference-output", lineageKey: "reference-1" },
      metadata: { assetPath: sourcePath }
    };
    const facet = createSharpLocalMediaFacet();
    const output = await facet.transform({
      operation: "resize",
      inputs: [referenceInput],
      parameters: { width: 4, height: 2, preserveAspectRatio: false },
      signal: new AbortController().signal,
      stagingDirectory
    });
    expect(output).toHaveLength(1);
    expect(png(await readFile(output[0]!.stagedPath))).toMatchObject({ width: 4, height: 2 });
    await expect(facet.transform({
      operation: "resize",
      inputs: [{ ...referenceInput, metadata: { assetPath: path.join(root, "outside.png") } }],
      parameters: { width: 4, height: 2, preserveAspectRatio: false },
      signal: new AbortController().signal,
      stagingDirectory
    })).rejects.toMatchObject({ code: "LOCAL_MEDIA_SOURCE_INVALID" });
  });
});

function graph(): EtherGraph {
  return {
    id: "root",
    title: "Local media",
    kind: "root",
    createdAt: at,
    updatedAt: at,
    nodes: [
      node("source", "generation.image", {
        kind: "generation.image",
        providerId: "ether-fake-local",
        profileId: "fake-image-default",
        aspectRatio: "2:1",
        resolution: { width: 4, height: 2 },
        outputCount: 1
      }),
      node("resize", "edit.transform", {
        kind: "edit.transform",
        operation: "resize",
        width: 6,
        height: 4,
        preserveAspectRatio: false
      }),
      node("mask", "edit.mask", {
        kind: "edit.mask",
        mode: "local",
        feather: 0,
        workspace: {
          sourceArtifactId: "source-artifact",
          geometry: {
            width: 4,
            height: 2,
            strokes: [
              { id: "paint", tool: "brush", size: 2, opacity: 1, points: [{ x: 1, y: 1, pressure: 1 }] },
              { id: "erase", tool: "eraser", size: 1, opacity: 1, points: [{ x: 3, y: 1, pressure: 1 }] }
            ]
          }
        }
      }),
      node("missing", "edit.transform", {
        kind: "edit.transform",
        operation: "resize",
        width: 2,
        height: 2,
        preserveAspectRatio: false
      })
    ],
    edges: [
      edge("source-resize", "resize"),
      edge("source-mask", "mask")
    ],
    groups: [],
    modules: [],
    viewState: {
      viewport: { x: 0, y: 0, zoom: 1 },
      selectedNodeIds: [],
      selectedEdgeIds: [],
      inspectorTarget: null
    }
  };
}

function node(id: string, definitionId: "generation.image" | "edit.transform" | "edit.mask", config: EtherGraph["nodes"][number]["config"]): EtherGraph["nodes"][number] {
  return {
    id,
    definitionId,
    title: id,
    position: { x: 0, y: 0 },
    size: { width: 220, height: 160 },
    config,
    presentation: { collapsed: false, accent: "default", previewMode: "summary" }
  } as EtherGraph["nodes"][number];
}

function edge(id: string, targetNodeId: string): EtherGraph["edges"][number] {
  return {
    id,
    from: { kind: "node", nodeId: "source", channel: "image" },
    to: { kind: "node", nodeId: targetNodeId, channel: "image" },
    role: "subject",
    order: 0,
    selector: { kind: "latest" },
    adapter: { kind: "auto" },
    enabled: true
  };
}

async function insertSource(app: EtherApplication, contentKey: string, byteLength: number): Promise<void> {
  const head = await app.boundaryStore().read(({ revisions }) => revisions.head());
  const version: NodeOutputVersion = {
    id: "source-output",
    nodeId: "source",
    graphId: "root",
    graphRevisionId: head.graphRevisions.root!,
    inputPayloadIds: [],
    selectedOutputVersionIds: [],
    compiledContextHash: "source",
    producer: { kind: "local", executor: "image-provider" },
    outputPayloadIds: ["source-payload"],
    parentOutputVersionId: null,
    approval: { state: "unreviewed" },
    runId: null,
    stepId: null,
    workItemId: null,
    attemptId: null,
    timing: { startedAt: at, completedAt: at },
    failure: null,
    createdAt: at
  };
  const payload: PayloadEnvelope = {
    id: "source-payload",
    channel: "image",
    role: "subject",
    content: { kind: "artifact", artifactId: "source-artifact" },
    source: { nodeId: "source", outputVersionId: version.id, lineageKey: "source" },
    metadata: { width: 4, height: 2 }
  };
  await app.boundaryStore().transaction(({ artifacts, outputs }) => {
    outputs.insert(version, [payload]);
    artifacts.attach({
      id: "source-artifact",
      contentKey,
      channel: "image",
      mediaType: "image/png",
      byteLength,
      source: { outputVersionId: version.id, payloadId: payload.id },
      createdAt: at,
      metadata: { width: 4, height: 2 }
    });
  });
}

async function start(app: EtherApplication, nodeId: string) {
  const plan = await app.previewRun({ commandId: `preview-${nodeId}`, graphId: "root", scope: { kind: "node", nodeId } });
  const permit = await app.grantRunPermit({ commandId: `permit-${nodeId}`, planId: plan.id, contentHash: plan.contentHash });
  const job = await app.startRun({
    commandId: `start-${nodeId}`,
    planId: plan.id,
    contentHash: plan.contentHash,
    runPermitId: permit.id
  });
  return app.waitForJob(job.id);
}

async function completedOutput(
  app: EtherApplication,
  nodeId: string,
  jobId: string
): Promise<{ artifact: Artifact; payload: PayloadEnvelope; version: NodeOutputVersion }> {
  const version = (await app.queryNodeOutputs(nodeId)).find((candidate) => candidate.runId === jobId);
  if (version === undefined) throw new Error(`No ${nodeId} output was published for job ${jobId}.`);
  const payloadId = version.outputPayloadIds[0];
  if (payloadId === undefined) throw new Error(`Output ${version.id} has no payload.`);
  const result = await app.boundaryStore().read(({ artifacts, outputs }) => {
    const payload = outputs.getPayload(payloadId);
    const artifact = payload?.content.kind === "artifact" ? artifacts.get(payload.content.artifactId) : undefined;
    return { artifact, payload };
  });
  if (result.payload === undefined || result.artifact === undefined) throw new Error(`Output ${version.id} has no immutable artifact.`);
  return { artifact: result.artifact, payload: result.payload, version };
}

function png(bytes: Uint8Array): { height: number; pixels: number[]; width: number } {
  const source = Buffer.from(bytes);
  expect(source.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  let offset = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat: Buffer[] = [];
  while (offset < source.length) {
    const length = source.readUInt32BE(offset);
    const kind = source.toString("ascii", offset + 4, offset + 8);
    const data = source.subarray(offset + 8, offset + 8 + length);
    offset += length + 12;
    if (kind === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const bitDepth = data[8];
      const colorType = data[9];
      if (bitDepth !== 8 || data[12] !== 0) throw new Error("Expected a non-interlaced 8-bit PNG.");
      channels = ({ 0: 1, 2: 3, 4: 2, 6: 4 } as Record<number, number>)[colorType!] ?? 0;
      if (channels === 0) throw new Error(`Unsupported PNG color type ${colorType}.`);
    } else if (kind === "IDAT") {
      idat.push(data);
    } else if (kind === "IEND") {
      break;
    }
  }
  const stride = width * channels;
  const inflated = inflateSync(Buffer.concat(idat));
  const pixels: number[] = [];
  let cursor = 0;
  let previous = Buffer.alloc(stride);
  for (let row = 0; row < height; row += 1) {
    const filter = inflated[cursor++]!;
    const encoded = inflated.subarray(cursor, cursor + stride);
    cursor += stride;
    const decoded = Buffer.alloc(stride);
    for (let index = 0; index < stride; index += 1) {
      const left = index < channels ? 0 : decoded[index - channels]!;
      const above = previous[index]!;
      const upperLeft = index < channels ? 0 : previous[index - channels]!;
      decoded[index] = (encoded[index]! + pngFilter(filter, left, above, upperLeft)) & 0xff;
    }
    pixels.push(...decoded);
    previous = decoded;
  }
  return { width, height, pixels };
}

function pngFilter(filter: number, left: number, above: number, upperLeft: number): number {
  if (filter === 0) return 0;
  if (filter === 1) return left;
  if (filter === 2) return above;
  if (filter === 3) return Math.floor((left + above) / 2);
  if (filter === 4) {
    const prediction = left + above - upperLeft;
    const leftDistance = Math.abs(prediction - left);
    const aboveDistance = Math.abs(prediction - above);
    const upperLeftDistance = Math.abs(prediction - upperLeft);
    return leftDistance <= aboveDistance && leftDistance <= upperLeftDistance
      ? left
      : aboveDistance <= upperLeftDistance ? above : upperLeft;
  }
  throw new Error(`Unsupported PNG filter ${filter}.`);
}
