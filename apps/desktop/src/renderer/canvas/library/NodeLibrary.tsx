import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from "react";
import { Clock3, GripVertical, Search, Star } from "lucide-react";
import { NodeDefinitionIdSchema, type NodeDefinitionId, type NodeFamily, type NodeLibraryItem } from "@ether/schema";

import { useDesktopSettings } from "../../project/useDesktopSettings";

export const NODE_LIBRARY_DRAG_TYPE = "application/x-ether-node-definition";

const familyOrder: readonly NodeFamily[] = [
  "prompt", "reference", "generation", "edit", "review", "flow", "output", "canvas"
];

const familyGlyph: Record<NodeFamily, string> = {
  prompt: "Pr",
  reference: "Rf",
  generation: "Gn",
  edit: "Ed",
  review: "Rv",
  flow: "Fl",
  output: "Ou",
  canvas: "Cv"
};

type LibraryPreferences = { favorites: NodeDefinitionId[]; recent: NodeDefinitionId[] };
const defaultPreferences: LibraryPreferences = { favorites: [], recent: [] };

export function NodeLibrary({ catalog, error, readOnly, onAdd }: {
  catalog: readonly NodeLibraryItem[];
  error: string | null;
  readOnly: boolean;
  onAdd(definitionId: NodeDefinitionId): void;
}) {
  const [query, setQuery] = useState("");
  const [preferences, setPreferences] = useDesktopSettings<LibraryPreferences>(
    "ether.desktop.node-library.v1",
    defaultPreferences,
    normalizePreferences
  );
  const filtered = useMemo(() => filterNodeCatalog(catalog, query), [catalog, query]);
  const favorites = orderedItems(catalog, preferences.favorites);
  const recent = orderedItems(catalog, preferences.recent);
  const add = (definitionId: NodeDefinitionId) => {
    setPreferences((current) => ({
      ...current,
      recent: [definitionId, ...current.recent.filter((id) => id !== definitionId)].slice(0, 6)
    }));
    onAdd(definitionId);
  };
  const toggleFavorite = (definitionId: NodeDefinitionId) => setPreferences((current) => ({
    ...current,
    favorites: current.favorites.includes(definitionId)
      ? current.favorites.filter((id) => id !== definitionId)
      : [...current.favorites, definitionId]
  }));

  return (
    <aside className="node-library" aria-labelledby="node-library-title" data-testid="node-library">
      <header className="node-library-header">
        <div>
          <span>Registry / {catalog.length}</span>
          <strong id="node-library-title">Node Library</strong>
        </div>
        <small>{catalog.length === 0 ? "Loading" : `${filtered.length} visible`}</small>
      </header>
      <label className="node-library-search">
        <Search size={14} aria-hidden="true" />
        <span className="sr-only">Search node library</span>
        <input
          type="search"
          value={query}
          placeholder="Search tools, channels…"
          onChange={(event) => setQuery(event.target.value)}
        />
        <kbd>N</kbd>
      </label>
      {error !== null ? <p className="node-library-message" role="status">{error}</p> : null}
      {favorites.length > 0 ? (
        <LibraryShelf icon={<Star size={12} />} label="Favorites" items={favorites} readOnly={readOnly} onAdd={add} />
      ) : null}
      {recent.length > 0 ? (
        <LibraryShelf icon={<Clock3 size={12} />} label="Recent" items={recent} readOnly={readOnly} onAdd={add} />
      ) : null}
      <div className="node-library-catalog" aria-label="All canonical nodes">
        {familyOrder.map((family) => {
          const items = filtered.filter((item) => item.family === family);
          if (items.length === 0) return null;
          return (
            <section key={family} className={`node-library-family node-library-family-${family}`}>
              <h3><span>{familyGlyph[family]}</span>{capitalize(family)}<small>{items.length}</small></h3>
              {items.map((item) => (
                <NodeLibraryRow
                  key={item.definitionId}
                  item={item}
                  favorite={preferences.favorites.includes(item.definitionId)}
                  readOnly={readOnly}
                  onAdd={add}
                  onFavorite={toggleFavorite}
                />
              ))}
            </section>
          );
        })}
        {catalog.length > 0 && filtered.length === 0 ? (
          <p className="node-library-message">No node matches “{query}”. Try a channel such as Image or Data.</p>
        ) : null}
      </div>
      <footer className="node-library-footer">
        <GripVertical size={13} aria-hidden="true" /> Drag to place · click to center · double-click canvas for quick add
      </footer>
    </aside>
  );
}

function NodeLibraryRow({ item, favorite, readOnly, onAdd, onFavorite }: {
  item: NodeLibraryItem;
  favorite: boolean;
  readOnly: boolean;
  onAdd(definitionId: NodeDefinitionId): void;
  onFavorite(definitionId: NodeDefinitionId): void;
}) {
  const drag = (event: DragEvent<HTMLElement>) => {
    if (readOnly) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData(NODE_LIBRARY_DRAG_TYPE, item.definitionId);
    event.dataTransfer.setData("text/plain", item.definitionId);
  };
  const channels = channelSummary(item);
  return (
    <article
      className="node-library-item"
      draggable={!readOnly}
      data-node-definition={item.definitionId}
      title={`${item.description} Try: ${item.example}`}
      onDragStart={drag}
    >
      <button
        type="button"
        className="node-library-add"
        disabled={readOnly}
        aria-label={`Add ${item.title}`}
        aria-describedby={`node-help-${item.definitionId}`}
        onClick={() => onAdd(item.definitionId)}
      >
        <span className="node-library-item-icon" aria-hidden="true">{familyGlyph[item.family]}</span>
        <span className="node-library-item-copy">
          <strong>{item.title}</strong>
          <small>{item.description}</small>
          <em>{channels}</em>
        </span>
      </button>
      <button
        type="button"
        className="node-library-favorite"
        aria-label={`${favorite ? "Remove" : "Add"} ${item.title} ${favorite ? "from" : "to"} favorites`}
        aria-pressed={favorite}
        onClick={() => onFavorite(item.definitionId)}
      >
        <Star size={13} fill={favorite ? "currentColor" : "none"} aria-hidden="true" />
      </button>
      <p id={`node-help-${item.definitionId}`} className="node-library-help">
        <span>Try</span> {item.example}
      </p>
    </article>
  );
}

function LibraryShelf({ icon, label, items, readOnly, onAdd }: {
  icon: ReactNode;
  label: string;
  items: readonly NodeLibraryItem[];
  readOnly: boolean;
  onAdd(definitionId: NodeDefinitionId): void;
}) {
  return (
    <section className="node-library-shelf" aria-label={label}>
      <h3>{icon}{label}</h3>
      <div>
        {items.map((item) => (
          <button key={item.definitionId} type="button" disabled={readOnly} onClick={() => onAdd(item.definitionId)}>
            {item.title}
          </button>
        ))}
      </div>
    </section>
  );
}

export function QuickAddPalette({ anchor, catalog, onClose, onPick }: {
  anchor: { x: number; y: number };
  catalog: readonly NodeLibraryItem[];
  onClose(): void;
  onPick(item: NodeLibraryItem): void;
}) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const items = filterNodeCatalog(catalog, query).slice(0, 8);
  const activeItem = items[activeIndex];
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  useEffect(() => {
    setActiveIndex((current) => Math.min(current, Math.max(0, items.length - 1)));
  }, [items.length]);
  const choose = (index: number) => {
    const item = items[index];
    if (item !== undefined) onPick(item);
  };
  const keys = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => Math.min(items.length - 1, current + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => Math.max(0, current - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(activeIndex);
    }
  };
  return (
    <section
      className="quick-add-palette nodrag nopan"
      style={{ left: anchor.x, top: anchor.y }}
      role="dialog"
      aria-label="Quick add node"
      aria-modal="false"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <header><span>Quick add</span><kbd>Esc</kbd></header>
      <label>
        <Search size={14} aria-hidden="true" />
        <input
          ref={inputRef}
          autoFocus
          aria-label="Find a node"
          aria-controls="quick-add-matches"
          aria-activedescendant={activeItem === undefined ? undefined : `quick-add-${activeItem.definitionId}`}
          placeholder="Type a node, purpose, or channel"
          value={query}
          onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }}
          onKeyDown={keys}
        />
      </label>
      <div id="quick-add-matches" role="listbox" aria-label="Matching nodes">
        {items.map((item, index) => (
          <button
            key={item.definitionId}
            id={`quick-add-${item.definitionId}`}
            type="button"
            role="option"
            aria-selected={index === activeIndex}
            className={index === activeIndex ? "is-active" : ""}
            onMouseEnter={() => setActiveIndex(index)}
            onClick={() => onPick(item)}
          >
            <span className={`quick-add-family quick-add-family-${item.family}`}>{familyGlyph[item.family]}</span>
            <span><strong>{item.title}</strong><small>{item.description}</small></span>
            <em>{channelSummary(item)}</em>
          </button>
        ))}
        {items.length === 0 ? <p>No matching canonical node.</p> : null}
      </div>
    </section>
  );
}

export function filterNodeCatalog(catalog: readonly NodeLibraryItem[], query: string): NodeLibraryItem[] {
  const terms = query.toLocaleLowerCase().trim().split(/\s+/u).filter(Boolean);
  if (terms.length === 0) return [...catalog];
  return catalog.filter((item) => {
    const searchable = [
      item.title,
      item.definitionId,
      item.family,
      item.description,
      item.example,
      ...item.synonyms,
      ...item.inputChannels,
      ...item.outputChannels
    ].join(" ").toLocaleLowerCase();
    return terms.every((term) => searchable.includes(term));
  });
}

function channelSummary(item: NodeLibraryItem) {
  const inputs = item.inputChannels.length === 0 ? "—" : item.inputChannels.map(capitalize).join(" · ");
  const outputs = item.outputChannels.length === 0 ? "—" : item.outputChannels.map(capitalize).join(" · ");
  return `${inputs} → ${outputs}`;
}

function orderedItems(catalog: readonly NodeLibraryItem[], ids: readonly NodeDefinitionId[]) {
  return ids.flatMap((id) => {
    const item = catalog.find((candidate) => candidate.definitionId === id);
    return item === undefined ? [] : [item];
  });
}

function normalizePreferences(value: unknown): LibraryPreferences {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return defaultPreferences;
  const candidate = value as Record<string, unknown>;
  return {
    favorites: normalizeIds(candidate.favorites),
    recent: normalizeIds(candidate.recent).slice(0, 6)
  };
}

function normalizeIds(value: unknown): NodeDefinitionId[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const parsed = NodeDefinitionIdSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

function capitalize(value: string) {
  return value.charAt(0).toLocaleUpperCase() + value.slice(1);
}
