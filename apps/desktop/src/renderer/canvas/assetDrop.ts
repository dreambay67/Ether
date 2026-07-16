import type { AssetRecord } from "@ether/engine";

export type DroppedReferenceLinker = (
  projectId: string,
  filePath: string,
  options?: { role?: string }
) => Promise<AssetRecord>;

export async function linkDroppedReferenceFilesSequentially(
  projectId: string,
  filePaths: string[],
  linker: DroppedReferenceLinker,
  options?: { role?: string }
) {
  const assets: AssetRecord[] = [];

  for (const filePath of filePaths) {
    assets.push(await linker(projectId, filePath, options));
  }

  return assets;
}
