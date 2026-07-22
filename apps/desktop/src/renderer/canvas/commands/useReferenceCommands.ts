import { useCallback } from "react";
export function useReferenceCommands(onStatus: (message: string) => void) { return { addReference: useCallback(() => onStatus("Use the Reference Desk to add or replace source material."), [onStatus]) }; }
