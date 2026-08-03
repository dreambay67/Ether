import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { BoxSelect, Command, CopyPlus, Keyboard, Play, Redo2, Trash2, Undo2, X } from "lucide-react";
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
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const shortcutsButtonRef = useRef<HTMLButtonElement>(null);
  const closeShortcuts = () => {
    setShortcutsOpen(false);
    globalThis.requestAnimationFrame(() => shortcutsButtonRef.current?.focus());
  };
  return <>
    <nav className="canvas-toolbar" aria-label="Canvas commands">
      <span className="canvas-toolbar-context">Canvas</span>
      {TOOLBAR_COMMANDS.map(({ id, icon, compact }) => {
        const item = byId.get(id);
        if (!item) return null;
        return <button key={id} type="button" className={compact ? "is-compact" : undefined} disabled={!item.enabled} aria-label={item.label} aria-keyshortcuts={item.shortcut} title={item.enabled ? `${item.label}: ${item.shortcut}` : item.disabledReason} onMouseDown={(event) => { if (event.button === 0) { event.preventDefault(); void item.execute(); } }} onClick={(event) => { if (event.detail === 0) void item.execute(); }}>{icon}{compact ? null : item.label}</button>;
      })}
      <button ref={shortcutsButtonRef} type="button" className="is-compact" aria-label="Keyboard and pointer reference" aria-haspopup="dialog" aria-expanded={shortcutsOpen} title="Keyboard and pointer reference" onClick={() => setShortcutsOpen(true)}><Keyboard size={15} aria-hidden="true" /></button>
    </nav>
    {paletteOpen ? <CommandPalette commands={commands} onClose={onPaletteClose} /> : null}
    {shortcutsOpen ? <ShortcutReference commands={commands} onClose={closeShortcuts} /> : null}
  </>;
}

function ShortcutReference({ commands, onClose }: { commands: readonly GraphCommand[]; onClose(): void }) {
  const dialogRef = useRef<HTMLElement>(null);
  useEffect(() => dialogRef.current?.querySelector<HTMLButtonElement>("button")?.focus(), []);
  const keepFocus = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), [href], [tabindex]:not([tabindex='-1'])") ?? [])];
    if (focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && globalThis.document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && globalThis.document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  return <div className="canvas-shortcut-scrim" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialogRef} className="canvas-shortcut-reference" role="dialog" aria-modal="true" aria-labelledby="canvas-shortcut-title" onKeyDown={keepFocus}>
      <header><div><span>Canvas help</span><h2 id="canvas-shortcut-title">Keyboard and pointer reference</h2></div><button type="button" aria-label="Close keyboard and pointer reference" onClick={onClose}><X size={17} aria-hidden="true" /></button></header>
      <div className="canvas-shortcut-body">
        <section aria-labelledby="canvas-gestures-title"><h3 id="canvas-gestures-title">Pointer</h3><dl>
          <div><dt>Left drag on canvas</dt><dd>Marquee-select nodes</dd></div>
          <div><dt>Shift + left drag</dt><dd>Add nodes to the selection</dd></div>
          <div><dt>Left drag on node</dt><dd>Move the selected nodes</dd></div>
          <div><dt>Right drag</dt><dd>Pan the canvas</dd></div>
          <div><dt>Double-click canvas</dt><dd>Open quick add at the pointer</dd></div>
        </dl></section>
        <section aria-labelledby="canvas-commands-title"><h3 id="canvas-commands-title">Commands</h3><dl>{commands.map((command) => <div key={command.id}><dt><kbd>{command.shortcut}</kbd></dt><dd>{command.label}<small>{command.enabled ? "Ready" : command.disabledReason}</small></dd></div>)}</dl></section>
      </div>
    </section>
  </div>;
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
