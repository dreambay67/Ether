import { useCallback, type DragEvent } from "react";
import type { NodePosition } from "@ether/schema";

export type CanvasReferenceDropHandler = (
  files: readonly File[],
  position: NodePosition,
  targetNodeId: string | null
) => void | Promise<void>;

export type CanvasFileDropKind = "none" | "document" | "reference";

export function classifyCanvasFileDrop(files: readonly Pick<File, "name">[]): CanvasFileDropKind {
  if (files.length === 0) return "none";
  return files.some((file) => file.name.toLocaleLowerCase().endsWith(".ether")) ? "document" : "reference";
}

export async function importReferenceFilesSequentially<Result>(
  files: readonly File[],
  importer: (file: File) => Promise<Result>
): Promise<Result[]> {
  const results: Result[] = [];
  for (const file of files) results.push(await importer(file));
  return results;
}

/**
 * Keep file-drop policy in one place. `.ether` documents deliberately pass
 * through to the shell's document opener; only ordinary files are offered to
 * the Reference Set flow.
 */
export function useDropCommands(
  onStatus: (message: string) => void,
  onReferenceDrop?: CanvasReferenceDropHandler
) {
  const onDrop = useCallback((
    event: DragEvent<HTMLElement>,
    position: NodePosition,
    targetNodeId: string | null
  ) => {
    const files = Array.from(event.dataTransfer.files);
    if (classifyCanvasFileDrop(files) !== "reference" || onReferenceDrop === undefined) return false;
    event.preventDefault();
    event.stopPropagation();
    try {
      void Promise.resolve(onReferenceDrop(files, position, targetNodeId)).catch((error) => {
        onStatus(error instanceof Error ? error.message : "Dropped references could not be imported.");
      });
    } catch (error) {
      onStatus(error instanceof Error ? error.message : "Dropped references could not be imported.");
    }
    return true;
  }, [onReferenceDrop, onStatus]);

  return { onDrop };
}
