import { useCallback, useEffect, useMemo, useState } from "react";

const fingerprint = (value: unknown) => JSON.stringify(value);

type DraftState<T> = {
  key: string;
  base: T;
  draft: T;
  dirty: boolean;
  conflict: boolean;
};

export function useInspectorDraft<T>(key: string, incoming: T) {
  const incomingFingerprint = useMemo(() => fingerprint(incoming), [incoming]);
  const [state, setState] = useState<DraftState<T>>({ key, base: incoming, draft: incoming, dirty: false, conflict: false });

  useEffect(() => {
    setState((current) => {
      if (current.key !== key) return { key, base: incoming, draft: incoming, dirty: false, conflict: false };
      if (!current.dirty) return fingerprint(current.base) === incomingFingerprint ? current : { key, base: incoming, draft: incoming, dirty: false, conflict: false };
      if (fingerprint(current.base) !== incomingFingerprint) return current.conflict ? current : { ...current, conflict: true };
      return current;
    });
  }, [incoming, incomingFingerprint, key]);

  const update = useCallback((next: T | ((current: T) => T)) => {
    setState((current) => {
      const draft = typeof next === "function" ? (next as (current: T) => T)(current.draft) : next;
      return { ...current, draft, dirty: fingerprint(draft) !== fingerprint(current.base) };
    });
  }, []);

  const markCommitted = useCallback(() => setState((current) => ({ ...current, base: current.draft, dirty: false, conflict: false })), []);
  const useLatest = useCallback(() => setState({ key, base: incoming, draft: incoming, dirty: false, conflict: false }), [incoming, key]);
  const rebaseDraft = useCallback(() => setState((current) => ({ ...current, base: incoming, dirty: fingerprint(current.draft) !== incomingFingerprint, conflict: false })), [incoming, incomingFingerprint]);

  return { ...state, update, markCommitted, useLatest, rebaseDraft };
}
