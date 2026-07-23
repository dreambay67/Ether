import type { CanvasNoteConfig } from "@ether/schema";

export function NotePresentation({ config, compact = false }: { config: CanvasNoteConfig; compact?: boolean }) {
  return (
    <div className={`note-presentation note-${config.style}${compact ? " is-compact" : ""}`} data-testid={`note-${config.style}`}>
      {config.style === "cloud" ? (
        <svg className="note-silhouette" viewBox="0 0 240 128" preserveAspectRatio="none" aria-hidden="true">
          <path d="M49 108C25 108 10 94 14 75c3-17 17-28 34-28 6-20 23-33 44-29 13-17 39-19 56-4 18 0 33 12 38 29 23-2 41 12 42 31 2 21-16 35-42 35H49Z" />
        </svg>
      ) : config.style === "bubble" ? (
        <svg className="note-silhouette" viewBox="0 0 240 128" preserveAspectRatio="none" aria-hidden="true">
          <path d="M25 12h190c9 0 16 7 16 16v61c0 9-7 16-16 16H80c-14 12-29 18-47 18 10-9 15-18 16-28H25c-9 0-16-7-16-16V28c0-9 7-16 16-16Z" />
        </svg>
      ) : null}
      <p>{config.body || "Write a note…"}</p>
    </div>
  );
}
