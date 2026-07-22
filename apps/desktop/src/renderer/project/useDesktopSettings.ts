import { useCallback, useState } from "react";

/** Small renderer-only preference store. Document data never lives here. */
export function useDesktopSettings<T>(
  key: string,
  fallback: T,
  normalize: (value: unknown, fallback: T) => T = defaultNormalizer
) {
  const [stored, setStored] = useState<{ key: string; value: T }>(() => ({
    key,
    value: readSetting(key, fallback, normalize)
  }));
  const value = stored.key === key ? stored.value : readSetting(key, fallback, normalize);

  const update = useCallback((next: T | ((current: T) => T)) => {
    setStored((current) => {
      const currentValue = current.key === key
        ? current.value
        : readSetting(key, fallback, normalize);
      const resolved = normalize(
        typeof next === "function" ? (next as (current: T) => T)(currentValue) : next,
        fallback
      );
      try {
        window.localStorage.setItem(key, JSON.stringify(resolved));
      } catch {
        // Layout preferences are optional; a restricted profile must not break the workspace.
      }
      return { key, value: resolved };
    });
  }, [fallback, key, normalize]);

  return [value, update] as const;
}

function readSetting<T>(key: string, fallback: T, normalize: (value: unknown, fallback: T) => T): T {
  try {
    const stored = window.localStorage.getItem(key);
    return normalize(stored === null ? fallback : JSON.parse(stored), fallback);
  } catch {
    return fallback;
  }
}

function defaultNormalizer<T>(value: unknown, fallback: T): T {
  return value === undefined ? fallback : value as T;
}
