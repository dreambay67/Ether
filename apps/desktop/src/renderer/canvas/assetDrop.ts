export type DroppedReferenceLinker<Asset> = (
  projectId: string,
  filePath: string,
  options?: { role?: string }
) => Promise<Asset>;

export async function linkDroppedReferenceFilesSequentially<Asset>(
  projectId: string,
  filePaths: string[],
  linker: DroppedReferenceLinker<Asset>,
  options?: { role?: string }
) {
  const assets: Asset[] = [];

  for (const filePath of filePaths) {
    assets.push(await linker(projectId, filePath, options));
  }

  return assets;
}
