export type DocumentShortcutTarget = {
  matches?(selectors: string): boolean;
  closest?(selectors: string): unknown;
};

export function shouldSaveDocumentFromShortcut(
  event: Pick<KeyboardEvent, "ctrlKey" | "altKey" | "shiftKey" | "key" | "repeat">,
  target: EventTarget | null
): boolean {
  if (!event.ctrlKey || event.altKey || event.shiftKey || event.repeat || event.key.toLocaleLowerCase() !== "s") return false;
  const element = isShortcutTarget(target) ? target : null;
  return element === null || (
    !element.matches("input, textarea, select, [contenteditable=true]") &&
    !element.closest("[contenteditable=true]")
  );
}

function isShortcutTarget(target: EventTarget | null): target is EventTarget & Required<DocumentShortcutTarget> {
  if (target === null || typeof target !== "object") return false;
  const candidate = target as DocumentShortcutTarget;
  return typeof candidate.matches === "function" && typeof candidate.closest === "function";
}
