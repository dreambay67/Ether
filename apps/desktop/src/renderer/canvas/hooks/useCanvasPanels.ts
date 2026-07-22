import { useCallback, useState } from "react";
export function useCanvasPanels() { const [libraryOpen, setLibraryOpen] = useState(false); const [helpOpen, setHelpOpen] = useState(false); return { libraryOpen, helpOpen, toggleLibrary: useCallback(() => setLibraryOpen((value) => !value), []), toggleHelp: useCallback(() => setHelpOpen((value) => !value), []) }; }
