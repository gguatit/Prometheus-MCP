/**
 * ICache — simple response/embedding cache behind an interface. MVP: bounded
 * LRU in-memory. Production (roadmap): Redis. Used to memoize identical
 * generation requests and knowledge fetches within a session.
 */

export interface ICache<V> {
  get(key: string): V | undefined;
  set(key: string, value: V, ttlMs?: number): void;
  invalidate(key: string): void;
  clear(): void;
  size(): number;
}

interface Entry<V> {
  value: V;
  expiresAt?: number;
}

export class LruCache<V> implements ICache<V> {
  private readonly map = new Map<string, Entry<V>>();

  constructor(private readonly capacity: number = 128) {}

  get(key: string): V | undefined {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (e.expiresAt !== undefined && Date.now() > e.expiresAt) {
      this.map.delete(key);
      return undefined;
    }
    // refresh recency
    this.map.delete(key);
    this.map.set(key, e);
    return e.value;
  }

  set(key: string, value: V, ttlMs?: number): void {
    if (this.map.size >= this.capacity) {
      const firstKey = this.map.keys().next().value;
      if (firstKey !== undefined) this.map.delete(firstKey);
    }
    this.map.set(key, { value, expiresAt: ttlMs !== undefined ? Date.now() + ttlMs : undefined });
  }

  invalidate(key: string): void {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  size(): number {
    return this.map.size;
  }
}
