import { useEffect, useMemo, useRef, useState } from "react";
import { BoxSelect, Command, CopyPlus, Play, Redo2, Trash2, Undo2 } from "lucide-react";
import type { GraphCommand, GraphCommandId } from "./commands/useGraphCommands";

const TOOLBAR_COMMANDS: Array<{ id: GraphCommandId; icon: React.ReactNode; compact?: boolean }> = [
  { id: "duplicate", icon: <CopyPlus size={14} /> },
  { id: "delete", icon: <Trash2 size={14} /> },
  { id: "createModule", icon: <BoxSelect size={14} /> },
  { id: "runSelected", icon: <Play size={14} /> },
  { id: "undo", icon: <Undo2 size={15} />, compact: true },
  { id: "redo", icon: <Redo2 size={15} />, compact: true },
  { id: "palette", icon: <Command size={15} />, compact: true }
];

export function CanvasToolbar({ commands, paletteOpen, onPaletteClose }: { commands: readonly GraphCommand[]; paletteOpen: boolean; onPaletteClose(): void }) {
  const byId = useMemo(() => new Map(commands.map((command) => [command.id, command])), [commands]);
  return <>
    <nav className="canvas-toolbar" aria-label="Canvas commands">
      <span className="canvas-toolbar-context">Canvas</span>
      {TOOLBAR_COMMANDS.map(({ id, icon, compact }) => {
        const item = byId.get(id);
        if (!item) return null;
        return <button key={id} type="button" className={compact ? "is-compact" : undefined} disabled={!item.enabled} aria-label={item.label} aria-keyshortcuts={item.shortcut} title={item.enabled ? `${item.label}: ${item.shortcut}` : item.disabledReason} onPointerDown={(event) => event.preventDefault()} onClick={() => void item.execute()}>{icon}{compact ? null : item.label}</button>;
      })}
    </nav>
    {paletteOpen ? <CommandPalette commands={commands} onClose={onPaletteClose} /> : null}
  </>;
}

function CommandPalette({ commands, onClose }: { commands: readonly GraphCommand[]; onClose(): void }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const filtered = useMemo(() => commands.filter((command) => `${command.label} ${command.shortcut}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), [commands, query]);
  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => setActive((current) => Math.min(current, Math.max(0, filtered.length - 1))), [filtered.length]);
  const run = (command: GraphCommand | undefined) => {
    if (!command?.enabled) return;
    onClose();
    void command.execute();
  };
  return <div className="canvas-command-scrim" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="canvas-command-palette" role="dialog" aria-modal="true" aria-label="Canvas command palette">
      <label><span>Command palette</span><input ref={inputRef} value={query} placeholder="Type a canvas command…" onChange={(event) => { setQuery(event.target.value); setActive(0); }} onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") { event.preventDefault(); onClose(); }
        if (event.key === "ArrowDown") { event.preventDefault(); setActive((current) => Math.min(filtered.length - 1, current + 1)); }
        if (event.key === "ArrowUp") { event.preventDefault(); setActive((current) => Math.max(0, current - 1)); }
        if (event.key === "Enter") { event.preventDefault(); run(filtered[active]); }
      }} /></label>
      <div className="canvas-command-list" role="listbox" aria-label="Available canvas commands">
        {filtered.map((command, index) => <button key={command.id} type="button" role="option" aria-selected={index === active} className={index === active ? "is-active" : undefined} disabled={!command.enabled} title={command.disabledReason} onPointerDown={(event) => event.preventDefault()} onMouseEnter={() => setActive(index)} onClick={() => run(command)}><span>{command.label}<small>{command.enabled ? "Ready" : command.disabledReason}</small></span><kbd>{command.shortcut}</kbd></button>)}
        {filtered.length === 0 ? <p>No matching canvas commands.</p> : null}
      </div>
    </section>
  </div>;
}
