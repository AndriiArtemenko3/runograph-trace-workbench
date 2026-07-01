import { useEffect, useRef, useState } from "react";

// useDebouncedValue — returns `value` after `ms` has elapsed since the
// last change. Compares by JSON.stringify so object identity churn (a
// fresh `{ width, drawHeight }` literal each render) doesn't bypass the
// debounce. Generic over the value type.
export function useDebouncedValue<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState<T>(value);
  const lastKey = useRef<string>(JSON.stringify(value));
  useEffect(() => {
    const key = JSON.stringify(value);
    if (key === lastKey.current) return;
    const id = setTimeout(() => {
      lastKey.current = key;
      setDebounced(value);
    }, ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}
