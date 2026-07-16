import { useCallback, useEffect, useMemo, useState, type DragEvent, type ReactElement } from "react";
import { ChevronDown, ChevronUp, GalleryHorizontal, GitBranch, Grid2X2, PackagePlus, RefreshCcw } from "lucide-react";
import type { ArtifactKind, ArtifactRecord } from "@ether/engine";
import { ArtifactFilmstrip } from "./ArtifactFilmstrip";
import { ArtifactGrid, artifactTitle } from "./ArtifactGrid";
import { LineageView } from "./LineageView";

const artifactKinds: Array<ArtifactKind | "all"> = [
  "all",
  "image",
  "reference",
  "edit",
  "prompt",
  "negative_prompt",
  "mask",
  "compare",
  "evaluation",
  "route",
  "report",
  "collection_membership"
];

type ArtifactBrowserProps = {
  projectId: string;
  onStatus(message: string): void;
};

type BrowserTab = "filmstrip" | "grid" | "lineage" | "collections";

export function ArtifactBrowser({ projectId, onStatus }: ArtifactBrowserProps) {
  const [artifacts, setArtifacts] = useState<ArtifactRecord[]>([]);
  const [collectionArtifacts, setCollectionArtifacts] = useState<ArtifactRecord[]>([]);
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<BrowserTab>("grid");
  const [kind, setKind] = useState<ArtifactKind | "all">("all");
  const [search, setSearch] = useState("");
  const [collectionId, setCollectionId] = useState("");
  const [tagDrafts, setTagDrafts] = useState<Record<string, string>>({});
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState("Artifacts ready");

  const selectedArtifact = useMemo(
    () => artifacts.find((artifact) => artifact.id === selectedArtifactId) ?? artifacts[0] ?? null,
    [artifacts, selectedArtifactId]
  );

  const setBrowserStatus = useCallback(
    (nextMessage: string) => {
      setMessage(nextMessage);
      onStatus(nextMessage);
    },
    [onStatus]
  );

  const refreshArtifacts = useCallback(() => {
    let cancelled = false;
    const artifactBridge = window.ether.artifacts;

    if (!artifactBridge) {
      setArtifacts([]);
      setBrowserStatus("Artifact APIs are unavailable");
      return () => {
        cancelled = true;
      };
    }

    setIsLoading(true);

    const trimmedSearch = search.trim();

    artifactBridge
      .list(projectId, {
        kind: kind === "all" ? undefined : kind,
        search: trimmedSearch || undefined,
        collectionId: collectionId.trim() || undefined
      })
      .then((nextArtifacts) => {
        if (cancelled) {
          return;
        }

        setArtifacts(nextArtifacts);
        setSelectedArtifactId((current) =>
          current && nextArtifacts.some((artifact) => artifact.id === current)
            ? current
            : nextArtifacts[0]?.id ?? null
        );
        setMessage(`${nextArtifacts.length} artifact${nextArtifacts.length === 1 ? "" : "s"}`);
      })
      .catch((error) => {
        if (!cancelled) {
          setBrowserStatus(error instanceof Error ? error.message : "Artifact list failed");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [collectionId, kind, projectId, search, setBrowserStatus]);

  useEffect(() => refreshArtifacts(), [refreshArtifacts]);

  const reloadCollection = useCallback(async () => {
    const trimmedCollectionId = collectionId.trim();

    if (!trimmedCollectionId || !window.ether.artifacts) {
      setCollectionArtifacts([]);
      return;
    }

    try {
      const nextArtifacts = await window.ether.artifacts.listByCollection(projectId, trimmedCollectionId);
      setCollectionArtifacts(nextArtifacts);
      setBrowserStatus(`Collection has ${nextArtifacts.length} artifact${nextArtifacts.length === 1 ? "" : "s"}`);
    } catch (error) {
      setBrowserStatus(error instanceof Error ? error.message : "Collection lookup failed");
    }
  }, [collectionId, projectId, setBrowserStatus]);

  const selectArtifact = (artifact: ArtifactRecord) => {
    setSelectedArtifactId(artifact.id);
  };

  const tagArtifact = async (artifact: ArtifactRecord) => {
    const tag = tagDrafts[artifact.id]?.trim();

    if (!tag || !window.ether.artifacts) {
      return;
    }

    try {
      await window.ether.artifacts.tag(projectId, { artifactId: artifact.id, tag });
      setTagDrafts((drafts) => ({ ...drafts, [artifact.id]: "" }));
      setBrowserStatus(`Tagged ${artifactTitle(artifact)}`);
      refreshArtifacts();
    } catch (error) {
      setBrowserStatus(error instanceof Error ? error.message : "Tag failed");
    }
  };

  const rateArtifact = async (artifact: ArtifactRecord) => {
    if (!window.ether.artifacts) {
      return;
    }

    try {
      await window.ether.artifacts.rate(projectId, {
        artifactId: artifact.id,
        rating: 5,
        source: "artifact-browser"
      });
      setBrowserStatus(`Rated ${artifactTitle(artifact)}`);
      refreshArtifacts();
    } catch (error) {
      setBrowserStatus(error instanceof Error ? error.message : "Rate failed");
    }
  };

  const updateMetadata = async (artifact: ArtifactRecord) => {
    if (!window.ether.artifacts) {
      return;
    }

    try {
      await window.ether.artifacts.updateMetadata(projectId, {
        artifactId: artifact.id,
        metadata: { reviewedAt: new Date().toISOString() }
      });
      setBrowserStatus(`Reviewed ${artifactTitle(artifact)}`);
      refreshArtifacts();
    } catch (error) {
      setBrowserStatus(error instanceof Error ? error.message : "Metadata update failed");
    }
  };

  const revealArtifact = async (artifact: ArtifactRecord) => {
    if (!window.ether.artifacts) {
      return;
    }

    try {
      await window.ether.artifacts.revealFile(projectId, artifact.id);
      setBrowserStatus(`Revealed ${artifactTitle(artifact)}`);
    } catch (error) {
      setBrowserStatus(error instanceof Error ? error.message : "Reveal failed");
    }
  };

  const addSelectedToCollection = async () => {
    const trimmedCollectionId = collectionId.trim();

    if (!trimmedCollectionId || !selectedArtifact || !window.ether.artifacts) {
      return;
    }

    try {
      await window.ether.artifacts.addToCollection(projectId, {
        artifactId: selectedArtifact.id,
        collectionId: trimmedCollectionId
      });
      setBrowserStatus(`Added ${artifactTitle(selectedArtifact)} to collection`);
      await reloadCollection();
    } catch (error) {
      setBrowserStatus(error instanceof Error ? error.message : "Collection update failed");
    }
  };

  const startArtifactDrag = (event: DragEvent<HTMLElement>, artifact: ArtifactRecord) => {
    if (!artifact.path) {
      return;
    }

    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("application/ether-image-asset", JSON.stringify(artifactDragPayload(artifact)));
    event.dataTransfer.setData("text/plain", artifact.path);
  };

  const grid = (
    <ArtifactGrid
      artifacts={artifacts}
      selectedArtifactId={selectedArtifact?.id ?? null}
      tagDrafts={tagDrafts}
      onSelect={selectArtifact}
      onDragStart={startArtifactDrag}
      onTagDraftChange={(artifactId, value) => setTagDrafts((drafts) => ({ ...drafts, [artifactId]: value }))}
      onTag={(artifact) => void tagArtifact(artifact)}
      onRate={(artifact) => void rateArtifact(artifact)}
      onReveal={(artifact) => void revealArtifact(artifact)}
      onUpdateMetadata={(artifact) => void updateMetadata(artifact)}
    />
  );

  return (
    <section
      className={`artifact-browser${isCollapsed ? " is-collapsed" : ""}`}
      data-testid="artifact-browser"
      aria-label="Artifact browser"
    >
      <div className="artifact-browser-header">
        <div>
          <p>Artifacts</p>
          <h2>Artifact Browser</h2>
        </div>
        <span>{isLoading ? "Loading..." : message}</span>
        <button type="button" title="Refresh artifacts" onClick={() => refreshArtifacts()}>
          <RefreshCcw size={14} aria-hidden="true" />
        </button>
        <button
          type="button"
          title={isCollapsed ? "Expand artifact browser" : "Collapse artifact browser"}
          aria-expanded={!isCollapsed}
          onClick={() => setIsCollapsed((current) => !current)}
        >
          {isCollapsed ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
        </button>
      </div>

      <div className="artifact-browser-body" aria-hidden={isCollapsed}>
        <div className="artifact-browser-controls">
          <label>
            Search
            <input
              data-testid="artifact-search"
              value={search}
              placeholder="title, tag, path"
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <label>
            Type
            <select
              data-testid="artifact-kind-filter"
              value={kind}
              onChange={(event) => setKind(event.target.value as ArtifactKind | "all")}
            >
              {artifactKinds.map((candidate) => (
                <option key={candidate} value={candidate}>
                  {candidate === "all" ? "All" : candidate}
                </option>
              ))}
            </select>
          </label>
          <label>
            Collection
            <input
              data-testid="artifact-collection-filter"
              value={collectionId}
              placeholder="collection id"
              onChange={(event) => setCollectionId(event.target.value)}
            />
          </label>
        </div>

        <div className="artifact-tabs" role="tablist" aria-label="Artifact views">
          <TabButton tab="filmstrip" activeTab={activeTab} onSelect={setActiveTab} />
          <TabButton tab="grid" activeTab={activeTab} onSelect={setActiveTab} />
          <TabButton tab="lineage" activeTab={activeTab} onSelect={setActiveTab} />
          <TabButton tab="collections" activeTab={activeTab} onSelect={setActiveTab} />
        </div>

        <div className="artifact-browser-content">
          {activeTab === "filmstrip" ? (
            <ArtifactFilmstrip
              artifacts={artifacts}
              selectedArtifactId={selectedArtifact?.id ?? null}
              onSelect={selectArtifact}
              onDragStart={startArtifactDrag}
            />
          ) : null}
          {activeTab === "grid" ? grid : null}
          {activeTab === "lineage" ? (
            <LineageView projectId={projectId} artifact={selectedArtifact} onStatus={setBrowserStatus} />
          ) : null}
          {activeTab === "collections" ? (
            <CollectionView
              artifacts={collectionArtifacts}
              selectedArtifact={selectedArtifact}
              collectionId={collectionId}
              onAddSelected={() => void addSelectedToCollection()}
              onReload={() => void reloadCollection()}
            />
          ) : null}
        </div>
      </div>
    </section>
  );
}

function TabButton({
  tab,
  activeTab,
  onSelect
}: {
  tab: BrowserTab;
  activeTab: BrowserTab;
  onSelect(tab: BrowserTab): void;
}) {
  const labels: Record<BrowserTab, string> = {
    filmstrip: "Filmstrip",
    grid: "Grid",
    lineage: "Lineage",
    collections: "Collections"
  };
  const icons: Record<BrowserTab, ReactElement> = {
    filmstrip: <GalleryHorizontal size={14} aria-hidden="true" />,
    grid: <Grid2X2 size={14} aria-hidden="true" />,
    lineage: <GitBranch size={14} aria-hidden="true" />,
    collections: <PackagePlus size={14} aria-hidden="true" />
  };

  return (
    <button
      type="button"
      role="tab"
      aria-selected={activeTab === tab}
      data-testid={`artifact-${tab}-tab`}
      onClick={() => onSelect(tab)}
    >
      {icons[tab]}
      {labels[tab]}
    </button>
  );
}

function CollectionView({
  artifacts,
  selectedArtifact,
  collectionId,
  onAddSelected,
  onReload
}: {
  artifacts: ArtifactRecord[];
  selectedArtifact: ArtifactRecord | null;
  collectionId: string;
  onAddSelected(): void;
  onReload(): void;
}) {
  return (
    <div className="artifact-collections" data-testid="artifact-collections">
      <div className="artifact-collection-actions">
        <button type="button" onClick={onReload} disabled={!collectionId.trim()}>
          <RefreshCcw size={14} aria-hidden="true" />
          Load
        </button>
        <button type="button" onClick={onAddSelected} disabled={!collectionId.trim() || !selectedArtifact}>
          <PackagePlus size={14} aria-hidden="true" />
          Add Selected
        </button>
      </div>
      <div className="artifact-collection-list">
        {artifacts.length === 0 ? <p className="artifact-empty">No collection artifacts loaded.</p> : null}
        {artifacts.map((artifact) => (
          <article key={artifact.id} className="artifact-lineage-card">
            <span>{artifact.kind}</span>
            <strong>{artifactTitle(artifact)}</strong>
            <p>{artifact.path ?? artifact.id}</p>
          </article>
        ))}
      </div>
    </div>
  );
}

function artifactDragPayload(artifact: ArtifactRecord) {
  const isCopiedArtifact = typeof artifact.metadata.copiedFromAssetId === "string";
  const metadataAssetId = typeof artifact.metadata.assetId === "string" ? artifact.metadata.assetId : "";
  const assetId = !isCopiedArtifact && metadataAssetId ? metadataAssetId : undefined;
  const assetKind = typeof artifact.metadata.assetKind === "string"
    ? artifact.metadata.assetKind
    : assetKindForArtifact(artifact);
  const assetMetadata = { ...artifact.metadata };

  if (isCopiedArtifact) {
    delete assetMetadata.assetId;
  }

  return {
    nodeId: artifact.nodeId ?? `artifact:${artifact.id}`,
    ...(assetId ? { assetId } : {}),
    assetKind,
    assetPath: artifact.path,
    assetMetadata: {
      ...assetMetadata,
      artifactId: artifact.id,
      artifactKind: artifact.kind
    },
    title: artifactTitle(artifact)
  };
}

function assetKindForArtifact(artifact: ArtifactRecord) {
  if (artifact.kind === "reference" || artifact.kind === "mask") {
    return artifact.kind;
  }

  return "generated";
}
