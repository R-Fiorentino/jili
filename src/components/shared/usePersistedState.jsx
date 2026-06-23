import React from "react";

function resolveInitialValue(initialValue) {
  return typeof initialValue === "function" ? initialValue() : initialValue;
}

export default function usePersistedState(key, initialValue, { storage = "session" } = {}) {
  const [value, setValue] = React.useState(() => {
    const fallback = resolveInitialValue(initialValue);
    if (!key || typeof window === "undefined") return fallback;

    try {
      const storageApi = storage === "local" ? window.localStorage : window.sessionStorage;
      const raw = storageApi.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  });

  React.useEffect(() => {
    if (!key || typeof window === "undefined") return;

    try {
      const storageApi = storage === "local" ? window.localStorage : window.sessionStorage;
      storageApi.setItem(key, JSON.stringify(value));
    } catch {
      // Ignore storage failures; the UI should still behave normally.
    }
  }, [key, storage, value]);

  return [value, setValue];
}
