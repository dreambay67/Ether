import { describe, expect, it } from "vitest";
import { resolveReferencePreview, type ReferencePreviewResolution } from "../../../apps/desktop/src/renderer/references/ReferenceGrid";
import type { ReferenceDeskItem } from "../../../apps/desktop/src/renderer/references/useReferences";

const previewKey = "a".repeat(64);
const contentKey = "b".repeat(64);

const linkedReference: ReferenceDeskItem = {
  id: "reference-linked",
  displayName: "Linked source.png",
  mediaType: "image/png",
  state: "linked",
  originalPath: null,
  pathGrantId: "grant-reference",
  contentKey: null,
  previewContentKey: previewKey,
  identity: null,
  fingerprint: { byteLength: 128, modifiedAt: 1, sampleSha256: previewKey },
  createdAt: "2026-08-10T00:00:00.000Z",
  updatedAt: "2026-08-10T00:00:00.000Z",
  actions: []
};

describe("reference media preview resolution", () => {
  it("uses the embedded preview key for linked and missing sources without exposing a path", () => {
    const missing = { ...linkedReference, state: "missing" as const };
    const resolution = resolveReferencePreview("document-1", missing);

    expect(resolution).toEqual({
      kind: "image",
      source: `ether-asset://document-1/${previewKey}/original`
    });
    expect(resolutionSource(resolution)).not.toMatch(/^file:/iu);
  });

  it("prefers embedded original content while falling back to an embedded preview key", () => {
    const embedded: ReferenceDeskItem = {
      ...linkedReference,
      state: "embedded",
      pathGrantId: null,
      contentKey,
      previewContentKey: previewKey
    };

    expect(resolveReferencePreview("document-1", embedded)).toEqual({
      kind: "image",
      source: `ether-asset://document-1/${contentKey}/original`
    });
    expect(resolveReferencePreview("document-1", { ...embedded, contentKey: null })).toEqual({
      kind: "image",
      source: `ether-asset://document-1/${previewKey}/original`
    });
  });

  it.each([
    ["image/jpeg", "image"],
    ["video/mp4", "video"],
    ["audio/mpeg", "audio"]
  ] as const)("resolves a safe %s media element kind", (mediaType, kind) => {
    expect(resolveReferencePreview("document-1", { ...linkedReference, mediaType })).toMatchObject({ kind });
  });

  it("fails closed for absent or unsafe content and unsupported media types", () => {
    expect(resolveReferencePreview("document-1", { ...linkedReference, previewContentKey: null })).toEqual({
      kind: "unavailable",
      reason: "missing-content"
    });
    expect(resolveReferencePreview("document-1", {
      ...linkedReference,
      previewContentKey: "../outside" as unknown as string
    })).toEqual({
      kind: "unavailable",
      reason: "missing-content"
    });
    expect(resolveReferencePreview("document-1", { ...linkedReference, mediaType: "image/svg+xml" })).toEqual({
      kind: "unavailable",
      reason: "unsupported-media"
    });
  });
});

function resolutionSource(resolution: ReferencePreviewResolution): string {
  if (resolution.kind === "unavailable") throw new Error("Expected a resolved preview.");
  return resolution.source;
}
