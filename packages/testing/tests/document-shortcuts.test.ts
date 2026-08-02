import { describe, expect, it } from "vitest";

import { shouldSaveDocumentFromShortcut } from "../../../apps/desktop/src/renderer/project/documentShortcuts";

function event(overrides: Partial<KeyboardEvent> = {}): Pick<KeyboardEvent, "ctrlKey" | "altKey" | "shiftKey" | "key" | "repeat"> {
  return { ctrlKey: true, altKey: false, shiftKey: false, key: "s", repeat: false, ...overrides };
}

describe("document save shortcut", () => {
  it("routes a single Ctrl+S from ordinary canvas/chrome focus", () => {
    expect(shouldSaveDocumentFromShortcut(event(), null)).toBe(true);
  });

  it("does not steal repeated, modified, or text-editor keyboard input", () => {
    const textTarget = { matches: () => true, closest: () => null };
    const editableChild = { matches: () => false, closest: () => ({}) };
    expect(shouldSaveDocumentFromShortcut(event({ repeat: true }), null)).toBe(false);
    expect(shouldSaveDocumentFromShortcut(event({ altKey: true }), null)).toBe(false);
    expect(shouldSaveDocumentFromShortcut(event({ shiftKey: true }), null)).toBe(false);
    expect(shouldSaveDocumentFromShortcut(event({ key: "x" }), null)).toBe(false);
    expect(shouldSaveDocumentFromShortcut(event(), textTarget as never)).toBe(false);
    expect(shouldSaveDocumentFromShortcut(event(), editableChild as never)).toBe(false);
  });
});
