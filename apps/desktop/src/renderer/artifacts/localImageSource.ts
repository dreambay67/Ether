export function embeddedArtifactSource(
  documentId: string,
  artifactId: string,
  variant = "original"
): string {
  const segments = [documentId, artifactId, variant].map((value) => encodeURIComponent(value));
  return `ether-asset://${segments[0]}/${segments[1]}/${segments[2]}`;
}

export function localImageSource(source: string): string {
  if (source.startsWith("ether-asset://")) return source;
  throw new Error("Local file paths cannot be rendered. Use an embedded ether-asset URL.");
}
