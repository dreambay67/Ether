import { useEffect, useReducer } from "react";

import type {
  DesktopDocumentEvent,
  DocumentCommandResult,
  DocumentDescriptor
} from "../../shared/ipc/contracts";

export type DocumentSessionState = {
  snapshot: DocumentDescriptor | { documentId: string } | null;
  revision: number;
  saveState: "saving" | "saved" | "needs-attention";
  error: string | null;
  commandResult: DocumentCommandResult | null;
};

export type DocumentSessionAction =
  | {
      kind: "snapshot";
      revision: number;
      snapshot: DocumentDescriptor | { documentId: string };
      saveState?: DocumentSessionState["saveState"];
      error?: string | null;
      commandResult?: DocumentCommandResult;
    }
  | {
      kind: "event";
      revision: number;
      saveState?: DocumentSessionState["saveState"];
      error?: string | null;
      commandResult?: DocumentCommandResult;
    };

export function reduceDocumentSession(
  state: DocumentSessionState,
  action: DocumentSessionAction
): DocumentSessionState {
  if (action.revision <= state.revision) return state;
  if (action.kind === "snapshot") {
    const snapshotSaveState = "saveState" in action.snapshot ? action.snapshot.saveState : undefined;
    return {
      ...state,
      snapshot: action.snapshot,
      revision: action.revision,
      saveState: action.saveState ?? snapshotSaveState ?? state.saveState,
      error: action.error === undefined ? state.error : action.error,
      commandResult: action.commandResult ?? state.commandResult
    };
  }
  return {
    ...state,
    revision: action.revision,
    saveState: action.saveState ?? state.saveState,
    error: action.error === undefined ? state.error : action.error,
    commandResult: action.commandResult ?? state.commandResult
  };
}

const initialState: DocumentSessionState = {
  snapshot: null,
  revision: 0,
  saveState: "saved",
  error: null,
  commandResult: null
};

export function useDocumentSession() {
  const [state, dispatch] = useReducer(reduceDocumentSession, initialState);

  useEffect(() => {
    let active = true;
    const unsubscribe = window.ether.document.onEvent((event: DesktopDocumentEvent) => {
      if (!active) return;
      if (event.snapshot !== undefined) {
        dispatch({
          kind: "snapshot",
          revision: event.revision,
          snapshot: event.snapshot,
          saveState: event.saveState ?? event.snapshot.saveState,
          error: event.error?.message ?? null,
          commandResult: event.commandResult
        });
      } else {
        dispatch({
          kind: "event",
          revision: event.revision,
          saveState: event.saveState,
          error: event.error?.message ?? null,
          commandResult: event.commandResult
        });
      }
    });
    void window.ether.document.bootstrap().then((snapshot) => {
      if (active) dispatch({ kind: "snapshot", revision: snapshot.revision, snapshot });
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return { state, dispatch };
}
