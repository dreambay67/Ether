import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { FakeImageProvider } from "@ether/providers";
import { describe, expect, it } from "vitest";

import { createEtherAssetProtocolHandler } from "../../../../apps/desktop/src/main/protocol/etherAssetProtocol.js";
import { DesktopApplicationService } from "../../../../apps/desktop/src/main/services/applicationService.js";

describe("ether-asset thumbnail and range performance", () => {
  it("serves a generated Ether thumbnail without reading the full original", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "ether-real-thumbnail-"));
    const service = new DesktopApplicationService({
      appDataRoot: path.join(root, "app-data"),
      appVersion: "4.0.0-performance",
      dialogs: {
        openDocument: async () => null,
        saveDocument: async () => null,
        locateReference: async () => null,
        searchReferenceFolder: async () => null,
        confirmPortable: async () => true
      },
      provider: new FakeImageProvider(),
      simulationMode: true
    });
    try {
      const document = await service.bootstrap();
      const [artifact] = await service.generateFakeArtifact(document.documentId);
      expect(artifact).toBeDefined();
      const original = await service.artifactAssetDescriptor(
        document.documentId,
        artifact!.id,
        "original"
      );
      const thumbnail = await service.artifactAssetDescriptor(
        document.documentId,
        artifact!.id,
        "thumbnail"
      );
      expect(thumbnail.contentKey).not.toBe(original.contentKey);
      expect(thumbnail.mediaType).toBe("image/webp");
      expect(thumbnail.byteLength).toBeLessThan(original.byteLength);

      const requests: Array<{ variant: string; start: number; endExclusive: number }> = [];
      const handler = createEtherAssetProtocolHandler({
        authorize: async (documentId, artifactId, variant) => {
          if (
            documentId !== document.documentId ||
            artifactId !== artifact!.id ||
            (variant !== "original" && variant !== "thumbnail")
          ) {
            return null;
          }
          const descriptor = await service.artifactAssetDescriptor(documentId, artifactId, variant);
          return {
            byteLength: descriptor.byteLength,
            contentHash: descriptor.contentKey,
            mediaType: descriptor.mediaType
          };
        },
        streamRange: (documentId, artifactId, variant, start, endExclusive) => {
          if (variant !== "original" && variant !== "thumbnail") {
            throw new Error("Unsupported artifact variant.");
          }
          requests.push({ variant, start, endExclusive });
          return service.streamArtifactAssetRange(
            documentId,
            artifactId,
            variant,
            start,
            endExclusive
          );
        }
      });

      const thumbnailStarted = performance.now();
      const preview = await handler(new Request(
        `ether-asset://${document.documentId}/${artifact!.id}/thumbnail`
      ));
      expect(preview.status).toBe(200);
      expect((await preview.arrayBuffer()).byteLength).toBe(thumbnail.byteLength);
      const thumbnailMs = performance.now() - thumbnailStarted;
      expect(thumbnailMs).toBeLessThan(200);

      const rangeStarted = performance.now();
      const range = await handler(new Request(
        `ether-asset://${document.documentId}/${artifact!.id}/original`,
        { headers: { Range: "bytes=0-7" } }
      ));
      expect(range.status).toBe(206);
      expect((await range.arrayBuffer()).byteLength).toBe(8);
      const rangeMs = performance.now() - rangeStarted;
      expect(rangeMs).toBeLessThan(200);
      expect(requests).toEqual([
        { variant: "thumbnail", start: 0, endExclusive: thumbnail.byteLength },
        { variant: "original", start: 0, endExclusive: 8 }
      ]);
      await service.compact(document.documentId);
      await expect(
        service.artifactAssetDescriptor(document.documentId, artifact!.id, "thumbnail")
      ).resolves.toEqual(thumbnail);
      console.info(`ETHER_PERFORMANCE_METRIC asset-thumbnail-range ${JSON.stringify({
        originalBytes: original.byteLength,
        thumbnailBytes: thumbnail.byteLength,
        requestedRangeBytes: 8,
        thumbnailMs,
        rangeMs
      })}`);
    } finally {
      await service.close().catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    }
  });
});
