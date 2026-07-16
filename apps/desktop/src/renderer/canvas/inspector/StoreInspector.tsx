import { FolderInput, FolderPlus } from "lucide-react";
import type { CanvasNodeData } from "@ether/engine/graph/nodeCatalog";
import { ReviewInspector } from "./ReviewInspector";
import type { InspectorNodeContext } from "./types";

type StoreInspectorProps = {
  context: InspectorNodeContext;
  onEnsureStoreFolder(id: string, updates?: Partial<CanvasNodeData>): void;
  onMoveLatestGeneratedAssetToCollection(id: string): void;
};

export function StoreInspector({
  context,
  onEnsureStoreFolder,
  onMoveLatestGeneratedAssetToCollection
}: StoreInspectorProps) {
  const { selectedNode, nodeData, nodeDraft, isLocked, hasOpenProject, commitNodeDraft, updateNodeDraft } = context;
  const canMirrorStoreFolder =
    nodeData.kind === "Store" && (nodeData.subtype === "Collection" || nodeData.subtype === "Directory");
  const folderName = nodeDraft.storeFolderName ?? nodeData.storeFolderName ?? nodeData.label ?? nodeData.title;
  const folderPath = nodeDraft.storePath ?? nodeData.storePath ?? "";
  const ensureStoreFolder = () => {
    updateNodeDraft({ storeFolderName: folderName, storePath: folderPath });
    onEnsureStoreFolder(selectedNode.id, { storeFolderName: folderName, storePath: folderPath });
  };
  const chooseStoreFolder = async () => {
    if (isLocked) {
      return;
    }

    const selectedPath = await window.ether.asset.selectStoreDirectory?.();

    if (!selectedPath) {
      return;
    }

    updateNodeDraft({ storePath: selectedPath });
    commitNodeDraft();
  };

  if (nodeData.kind !== "Store") {
    return null;
  }

  return (
    <>
      <ReviewInspector context={context} />
      {canMirrorStoreFolder ? (
        <section className="inspector-preview" data-testid="inspector-store-folder">
          <div>
            <span>{nodeData.subtype} Folder</span>
            <button
              type="button"
              className="run-node-button"
              onClick={ensureStoreFolder}
              disabled={!hasOpenProject || isLocked}
            >
              <FolderPlus size={14} aria-hidden="true" />
              Create / update
            </button>
          </div>
          <label title="Folder display name used when Ether creates a project-local folder.">
            Folder name
            <input
              aria-label="Folder name"
              value={folderName}
              onChange={(event) => updateNodeDraft({ storeFolderName: event.target.value })}
              onBlur={commitNodeDraft}
              disabled={isLocked}
            />
          </label>
          <label title="Optional local folder path. Leave blank to create this store under the current .ether project.">
            Folder path
            <textarea
              aria-label="Folder path"
              value={folderPath}
              placeholder="Blank uses the project-local store folder"
              onChange={(event) => updateNodeDraft({ storePath: event.target.value })}
              onBlur={commitNodeDraft}
              disabled={isLocked}
            />
          </label>
          <button
            type="button"
            className="run-node-button"
            onClick={() => void chooseStoreFolder()}
            disabled={isLocked || !window.ether.asset.selectStoreDirectory}
          >
            <FolderInput size={14} aria-hidden="true" />
            Choose folder
          </button>
          {nodeData.storePath ? <pre>{nodeData.storePath}</pre> : <p>Open a project to create the folder.</p>}
          {nodeData.subtype === "Collection" ? (
            <>
              <button
                type="button"
                className="run-node-button"
                onClick={() => onMoveLatestGeneratedAssetToCollection(selectedNode.id)}
                disabled={!hasOpenProject || isLocked}
              >
                <FolderInput size={14} aria-hidden="true" />
                Move pending generated
              </button>
              {nodeData.lastMovedAssetPath ? (
                <>
                  <span>Last moved</span>
                  <pre>{nodeData.lastMovedAssetPath}</pre>
                </>
              ) : null}
            </>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
