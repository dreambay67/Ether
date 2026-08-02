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

function isShortcutTarget(target: EventTarget | null): target is EventTarget & DocumentShortcutTarget {
  return target !== null && typeof target === "object" && (
    "matches" in target || "closest" in target
  );
}
