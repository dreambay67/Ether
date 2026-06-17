import path from "node:path";

const supportedImageExtensions = new Set([
  ".avif",
  ".bmp",
  ".gif",
  ".jpeg",
  ".jpg",
  ".png",
  ".svg",
  ".tif",
  ".tiff",
  ".webp"
]);

export function assertImageFilePathForIpc(filePath: string) {
  if (!supportedImageExtensions.has(path.extname(filePath).toLowerCase())) {
    throw new Error("Dropped reference must be an image file.");
  }
}
