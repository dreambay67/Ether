import { useCallback } from "react";
export function useDropCommands(onStatus: (message: string) => void) { return { onDrop: useCallback((event: React.DragEvent) => { event.preventDefault(); onStatus("Dropped material is ready to assign in the Reference Desk."); }, [onStatus]) }; }
