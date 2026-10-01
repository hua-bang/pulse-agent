/**
 * MCP App views run in an opaque-origin sandbox where touching
 * `window.localStorage` throws. Renderer code (i18n language memory, editor
 * preferences) assumes it exists, so swap in an in-memory Storage first.
 */
export function ensureUsableLocalStorage(): void {
  try {
    const probe = '__pulse_node_view_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return;
  } catch {
    // Fall through to the in-memory replacement.
  }
  const values = new Map<string, string>();
  const memory: Storage = {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: key => values.get(String(key)) ?? null,
    key: index => [...values.keys()][index] ?? null,
    removeItem: key => {
      values.delete(String(key));
    },
    setItem: (key, value) => {
      values.set(String(key), String(value));
    },
  };
  Object.defineProperty(window, 'localStorage', { configurable: true, value: memory });
}
