// Node 25 exposes a process-level `localStorage` global. Without a valid
// `--localstorage-file`, that object is only a placeholder and has no storage
// methods, which shadows jsdom's working browser implementation in Vitest.
// Keep browser tests on a working browser-like storage implementation.
if (typeof window !== 'undefined') {
  const values = new Map<string, string>();
  const storage = {} as Storage;
  Object.defineProperties(storage, {
    length: { enumerable: false, get: () => values.size },
    clear: {
      enumerable: false,
      value: () => {
        values.clear();
        for (const key of Object.keys(storage)) delete (storage as Record<string, unknown>)[key];
      },
    },
    getItem: { enumerable: false, value: (key: string) => values.get(String(key)) ?? null },
    key: { enumerable: false, value: (index: number) => [...values.keys()][index] ?? null },
    removeItem: {
      enumerable: false,
      value: (key: string) => {
        const name = String(key);
        values.delete(name);
        delete (storage as Record<string, unknown>)[name];
      },
    },
    setItem: {
      enumerable: false,
      value: (key: string, value: string) => {
        const name = String(key);
        values.set(name, String(value));
        Object.defineProperty(storage, name, { configurable: true, enumerable: true, value: String(value) });
      },
    },
  });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
}
