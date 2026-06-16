type ElectronWebUtils = {
  getPathForFile(file: File): string;
};

export function createDroppedFilePathReader(webUtils: ElectronWebUtils) {
  return (file: File): string | null => {
    const filePath = webUtils.getPathForFile(file);

    return filePath.trim() ? filePath : null;
  };
}
