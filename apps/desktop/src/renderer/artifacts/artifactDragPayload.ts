export type ArtifactDragBridge = {
  startDrag?(documentId: string, artifactIds: string[]): Promise<null>;
};

export async function startArtifactDrag(documentId: string, artifactIds: string[]) {
  const bridge = window.ether.artifacts as typeof window.ether.artifacts & ArtifactDragBridge;
  if (bridge.startDrag === undefined) throw new Error("Native artifact drag is not available in this desktop build.");
  await bridge.startDrag(documentId, artifactIds);
}
