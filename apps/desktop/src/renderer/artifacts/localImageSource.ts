export function localImageSource(filePath: string) {
  if (/^(file|https?|data):/i.test(filePath)) {
    return filePath;
  }

  const normalizedPath = filePath.replace(/\\/g, "/");
  const url = normalizedPath.startsWith("/")
    ? `file://${normalizedPath}`
    : `file:///${normalizedPath}`;

  return encodeURI(url);
}
