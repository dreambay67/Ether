import type { InspectorNodeContext } from "./types";

function artifactItems(artifact: Record<string, unknown> | null) {
  const items = Array.isArray(artifact?.membership)
    ? artifact.membership
    : Array.isArray(artifact?.items)
      ? artifact.items
      : [];

  return items
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item)))
    .slice(0, 8);
}

function artifactRoutes(artifact: Record<string, unknown> | null) {
  const routes = Array.isArray(artifact?.candidateRoutes)
    ? artifact.candidateRoutes
    : Array.isArray(artifact?.routed)
      ? artifact.routed
      : [];

  return routes
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item)))
    .slice(0, 8);
}

function textValue(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function textList(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function recordValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function shortId(value: unknown) {
  const id = textValue(value, "asset");

  return id.length > 18 ? `${id.slice(0, 8)}...${id.slice(-6)}` : id;
}

function localImageSource(filePath: string) {
  if (/^(file|https?|data):/i.test(filePath)) {
    return filePath;
  }

  const normalizedPath = filePath.replace(/\\/g, "/");
  const url = normalizedPath.startsWith("/") ? `file://${normalizedPath}` : `file:///${normalizedPath}`;

  return encodeURI(url);
}

type ReviewInspectorProps = {
  context: InspectorNodeContext;
};

export function ReviewInspector({ context }: ReviewInspectorProps) {
  const { nodeData, nodeDraft, isLocked, commitNodeDraft, commitInputOnEnter, updateNodeDraft } = context;
  const compareArtifact =
    nodeData.compareArtifact && typeof nodeData.compareArtifact === "object"
      ? (nodeData.compareArtifact as Record<string, unknown>)
      : null;
  const evaluationArtifact =
    nodeData.evaluationArtifact && typeof nodeData.evaluationArtifact === "object"
      ? (nodeData.evaluationArtifact as Record<string, unknown>)
      : null;
  const filterResult =
    nodeData.filterResult && typeof nodeData.filterResult === "object"
      ? (nodeData.filterResult as Record<string, unknown>)
      : null;
  const compareItems = artifactItems(compareArtifact);
  const evaluationItems = artifactItems(evaluationArtifact);
  const filterRoutes = artifactRoutes(filterResult);
  const compareLayout = Number(nodeDraft.compareLayout ?? nodeData.compareLayout ?? 4);
  const compareColumns = Number.isFinite(compareLayout) ? Math.min(4, Math.max(1, compareLayout)) : 4;
  const winnerAssetId = textValue(compareArtifact?.winnerAssetId);
  const compareNotes = textValue(compareArtifact?.notes);

  if (nodeData.kind !== "Review" && nodeData.kind !== "Store") {
    return null;
  }

  if (nodeData.subtype === "Compare") {
    return (
      <section className="inspector-preview" data-testid="inspector-compare-controls">
        <div>
          <span>Manual Review</span>
          <strong>{nodeDraft.reviewDecision ?? "review"}</strong>
        </div>
        <label title="Controls how many candidates are visible in the manual comparison grid.">
          Compare grid
          <select
            aria-label="Compare grid"
            value={String(nodeDraft.compareLayout ?? 4)}
            onChange={(event) => updateNodeDraft({ compareLayout: Number(event.target.value) })}
            onBlur={commitNodeDraft}
            disabled={isLocked}
          >
            {[2, 3, 4, 6, 8].map((layout) => (
              <option key={layout} value={layout}>
                {layout}
              </option>
            ))}
          </select>
        </label>
        <label>
          Rating
          <input
            aria-label="Rating"
            type="number"
            min={1}
            max={5}
            value={nodeDraft.reviewRating ?? ""}
            onChange={(event) => updateNodeDraft({ reviewRating: event.target.value ? Number(event.target.value) : undefined })}
            onBlur={commitNodeDraft}
            onKeyDown={commitInputOnEnter}
            disabled={isLocked}
          />
        </label>
        <label>
          Tags
          <input
            aria-label="Tags"
            value={nodeDraft.reviewTags ?? ""}
            onChange={(event) => updateNodeDraft({ reviewTags: event.target.value })}
            onBlur={commitNodeDraft}
            onKeyDown={commitInputOnEnter}
            disabled={isLocked}
          />
        </label>
        <label>
          Decision
          <select
            aria-label="Decision"
            value={nodeDraft.reviewDecision ?? "review"}
            onChange={(event) => updateNodeDraft({ reviewDecision: event.target.value })}
            onBlur={commitNodeDraft}
            disabled={isLocked}
          >
            <option value="review">Review</option>
            <option value="select">Select</option>
            <option value="favorite">Favorite</option>
            <option value="needs-edit">Needs edit</option>
            <option value="reject">Reject</option>
          </select>
        </label>
        <label>
          Review notes
          <textarea
            aria-label="Review notes"
            value={nodeDraft.reviewNotes ?? ""}
            onChange={(event) => updateNodeDraft({ reviewNotes: event.target.value })}
            onBlur={commitNodeDraft}
            disabled={isLocked}
          />
        </label>
        {compareArtifact ? (
          <div className="review-result-list" data-testid="inspector-compare-summary">
            <article className="review-result-card">
              <span>Winner</span>
              <strong>{winnerAssetId || "No winner selected"}</strong>
              {compareNotes ? <p>{compareNotes}</p> : null}
              {typeof compareArtifact.rating === "number" ? <small>Rating {compareArtifact.rating}/5</small> : null}
            </article>
            {compareItems.map((item, index) => (
              <article key={`${textValue(item.assetId, "asset")}-${index}`} className="review-result-card">
                <span>{textValue(item.decision, "review")}</span>
                <strong>{shortId(item.assetId)}</strong>
                <p>{textList(item.tags).join(", ") || "untagged"}</p>
                {numberValue(item.rating) ? <small>Rating {numberValue(item.rating)}/5</small> : null}
              </article>
            ))}
          </div>
        ) : null}
        {compareItems.length > 0 ? (
          <div
            className="compare-review-grid"
            data-testid="inspector-compare-grid"
            style={{ gridTemplateColumns: `repeat(${compareColumns}, minmax(0, 1fr))` }}
          >
            {compareItems.map((item, index) => {
              const assetPath = typeof item.assetPath === "string" ? item.assetPath : "";
              const assetId = typeof item.assetId === "string" ? item.assetId : `item-${index + 1}`;
              const decision = typeof item.decision === "string" ? item.decision : "review";

              return (
                <article key={`${assetId}-${index}`} className="compare-review-tile">
                  {assetPath ? <img src={localImageSource(assetPath)} alt="" /> : null}
                  <strong>{decision}</strong>
                  <span>{assetId}</span>
                </article>
              );
            })}
          </div>
        ) : null}
      </section>
    );
  }

  if (nodeData.subtype === "Evaluation" || nodeData.subtype === "Evaluate") {
    return (
      <section className="inspector-preview" data-testid="inspector-evaluate-controls">
        <div>
          <span>Evaluation</span>
          <strong>{nodeDraft.evaluationThreshold ?? 70}</strong>
        </div>
        <label title="Minimum score required for an output to route as passing.">
          Evaluation threshold
          <input
            aria-label="Evaluation threshold"
            type="number"
            min={0}
            max={100}
            value={nodeDraft.evaluationThreshold ?? 70}
            onChange={(event) => updateNodeDraft({ evaluationThreshold: Number(event.target.value) })}
            onBlur={commitNodeDraft}
            onKeyDown={commitInputOnEnter}
            disabled={isLocked}
          />
        </label>
        {evaluationArtifact ? (
          <div className="review-result-list" data-testid="inspector-evaluation-results">
            {textValue(evaluationArtifact.summary) ? (
              <article className="review-result-card">
                <span>Summary</span>
                <strong>{textValue(evaluationArtifact.summary)}</strong>
              </article>
            ) : null}
            {evaluationItems.map((item, index) => {
              const score = numberValue(item.score);
              const confidence = numberValue(item.confidence);
              const issues = textList(item.detectedIssues);

              return (
                <article key={`${textValue(item.assetId, "asset")}-${index}`} className="review-result-card">
                  <span>{textValue(item.decision, "review")}</span>
                  <strong>{score === null ? "No score" : `${score}/100`}</strong>
                  <p>{textValue(item.explanation, "No explanation recorded.")}</p>
                  <small>
                    {confidence === null ? "confidence n/a" : `confidence ${Math.round(confidence * 100)}%`}
                    {issues.length > 0 ? ` - ${issues.join(", ")}` : ""}
                  </small>
                </article>
              );
            })}
          </div>
        ) : null}
      </section>
    );
  }

  if (nodeData.subtype === "Filter") {
    return (
      <section className="inspector-preview" data-testid="inspector-filter-controls">
        <div>
          <span>Filter Routing</span>
          <strong>{nodeDraft.filterDryRun ? "dry run" : "auto"}</strong>
        </div>
        <label className="execution-toggle">
          <input
            aria-label="Auto-apply routes"
            type="checkbox"
            checked={nodeDraft.filterAutoApply !== false}
            onChange={(event) => updateNodeDraft({ filterAutoApply: event.target.checked })}
            disabled={isLocked}
          />
          Auto-apply
        </label>
        <label className="execution-toggle">
          <input
            aria-label="Dry run"
            type="checkbox"
            checked={nodeDraft.filterDryRun === true}
            onChange={(event) => updateNodeDraft({ filterDryRun: event.target.checked })}
            disabled={isLocked}
          />
          Dry run
        </label>
        <label title="Controls whether applying routes moves, copies, or links artifacts into collections.">
          Route mode
          <select
            aria-label="Route mode"
            value={nodeDraft.filterRouteMode ?? "move"}
            onChange={(event) => updateNodeDraft({ filterRouteMode: event.target.value as "move" | "copy" | "link" })}
            onBlur={commitNodeDraft}
            disabled={isLocked}
          >
            <option value="move">Move</option>
            <option value="copy">Copy</option>
            <option value="link">Link</option>
          </select>
        </label>
        <label>
          Manual override
          <input
            aria-label="Manual override"
            value={nodeDraft.filterManualOverride ?? ""}
            onChange={(event) => updateNodeDraft({ filterManualOverride: event.target.value })}
            onBlur={commitNodeDraft}
            onKeyDown={commitInputOnEnter}
            disabled={isLocked}
          />
        </label>
        <label title="Route syntax used by the filter node when assigning outputs to review buckets.">
          Routing rules
          <textarea
            aria-label="Routing rules"
            value={nodeDraft.filterRules ?? "pass -> Selected; needs-edit -> Needs Edit; fail -> Rejected"}
            onChange={(event) => updateNodeDraft({ filterRules: event.target.value })}
            onBlur={commitNodeDraft}
            disabled={isLocked}
          />
        </label>
        {filterResult ? (
          <div className="review-result-list" data-testid="inspector-filter-preview">
            {filterRoutes.map((route, index) => {
              const metadataChanges = recordValue(route.metadataChanges);
              const filterMetadata = recordValue(metadataChanges.filter);

              return (
                <article key={`${textValue(route.assetId, "asset")}-${index}`} className="review-result-card">
                  <span>{textValue(route.decision, "route")}</span>
                  <strong>{textValue(route.destinationCollectionName) || textValue(route.targetCollectionName, "Collection")}</strong>
                  <p>{textValue(route.mode, textValue(filterResult.mode, "move"))} route</p>
                  <small>
                    metadata {Object.keys(filterMetadata).length > 0 ? Object.keys(filterMetadata).join(", ") : "unchanged"}
                  </small>
                </article>
              );
            })}
          </div>
        ) : null}
      </section>
    );
  }

  return null;
}
