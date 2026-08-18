export function createCache({ maxEntries = 100 } = {}) {
  const entries = new Map();
  const stats = { evictions: 0 };
  return {
    set(key, value) {
      entries.delete(key);
      entries.set(key, value);
      while (entries.size > maxEntries) {
        const oldest = entries.keys().next().value;
        entries.delete(oldest);
        stats.evictions += 1;
      }
    },
    get(key) {
      return entries.get(key);
    },
    get size() {
      return entries.size;
    },
    stats() {
      return { ...stats };
    },
  };
}
