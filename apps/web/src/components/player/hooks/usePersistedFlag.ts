import { useCallback, useEffect, useState } from "react";

const read = (key: string, fallback: boolean): boolean => {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return raw === "1" || raw === "true";
  } catch {
    return fallback;
  }
};

const write = (key: string, value: boolean) => {
  try {
    localStorage.setItem(key, value ? "1" : "0");
  } catch {
    // ignore quota / private-mode failures
  }
};

/**
 * Boolean state mirrored into localStorage. Reads the persisted value on
 * mount (per-key, so multiple flags don't collide), writes back on every
 * change. Returns a tuple shaped like useState.
 */
export const usePersistedFlag = (
  key: string,
  fallback: boolean,
): [boolean, (next: boolean) => void, () => void] => {
  const [value, setValue] = useState<boolean>(() => read(key, fallback));

  useEffect(() => {
    write(key, value);
  }, [key, value]);

  const toggle = useCallback(() => setValue((v) => !v), []);

  return [value, setValue, toggle];
};
