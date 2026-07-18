import { useCallback, useEffect, useState } from "react";
import { Image, RefreshCcw, Search } from "lucide-react";
import type { Artifact } from "@ether/schema";

import { embeddedArtifactSource } from "./localImageSource";

export function ArtifactBrowser({ documentId }: { documentId: string }) {
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("Artifacts are embedded in this document");

  const refresh = useCallback(async () => {
    try {
      setArtifacts(await window.ether.artifacts.search(documentId, search));
      setMessage("Saved inside this document");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Artifacts need attention");
    }
  }, [documentId, search]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <aside className="artifact-browser task-nine-artifacts" aria-label="Embedded artifacts">
      <header>
        <div>
          <Image size={16} aria-hidden="true" />
          <strong>Artifacts</strong>
        </div>
        <button type="button" title="Refresh artifacts" aria-label="Refresh artifacts" onClick={() => void refresh()}>
          <RefreshCcw size={15} aria-hidden="true" />
        </button>
      </header>
      <label className="artifact-search-field">
        <Search size={14} aria-hidden="true" />
        <input
          value={search}
          placeholder="Search artifacts"
          aria-label="Search artifacts"
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void refresh();
          }}
        />
      </label>
      <p className="artifact-browser-status">{message}</p>
      <div className="embedded-artifact-grid">
        {artifacts.map((artifact) => (
          <figure key={artifact.id} data-testid="embedded-artifact">
            {artifact.mediaType.startsWith("image/") ? (
              <img
                src={embeddedArtifactSource(documentId, artifact.id)}
                alt={typeof artifact.metadata.title === "string" ? artifact.metadata.title : "Generated artifact"}
              />
            ) : (
              <div className="artifact-media-fallback">{artifact.mediaType}</div>
            )}
            <figcaption>{typeof artifact.metadata.title === "string" ? artifact.metadata.title : artifact.id}</figcaption>
          </figure>
        ))}
      </div>
    </aside>
  );
}
