export function embeddedArtifactSource(
  documentId: string,
  artifactId: string,
  variant = "original"
): string {
  const segments = [documentId, artifactId, variant].map((value) => encodeURIComponent(value));
  return `ether-asset://${segments[0]}/${segments[1]}/${segments[2]}`;
}
