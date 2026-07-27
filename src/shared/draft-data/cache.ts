/**
 * Disk cache for assembled draft statistics.
 *
 * Two properties matter more than speed here.
 *
 * **The key includes the patch**, taken from op.gg's own `meta.version` rather than from a clock or
 * a local guess. Champion balance changes every two weeks, and serving one patch's counters against
 * another's is the kind of error that produces confident, plausible, wrong advice. Keying on the
 * reported patch makes that structurally impossible rather than merely unlikely.
 *
 * **Entries expire**, because op.gg recomputes continuously within a patch and early-patch numbers
 * move a lot — a champion's rate is unreliable for several days after a change to it.
 */

export interface CacheKey {
  patch: string
  region: string
  tier: string
}

export interface CacheEntry<T> {
  key: CacheKey
  /** When this entry was written, epoch milliseconds. */
  storedAt: number
  value: T
}

export interface CacheStorage {
  read(name: string): Promise<string | undefined>
  write(name: string, contents: string): Promise<void>
  remove(name: string): Promise<void>
}

export function cacheFileName(prefix: string, key: CacheKey): string {
  // Region and tier are drawn from a fixed vocabulary, but the patch comes off the wire, so keep
  // the whole thing to characters that are safe in a filename.
  const parts = [prefix, key.patch, key.region, key.tier].map((p) =>
    String(p).replace(/[^a-zA-Z0-9._-]/g, '_')
  )

  return `${parts.join('__')}.json`
}

export interface CacheOptions {
  /** How long an entry stays usable. Defaults to a day, matching op.gg's own refresh cadence. */
  maxAgeMs?: number
  now?: () => number
}

const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000

export class DraftStatsCache {
  constructor(
    private readonly _storage: CacheStorage,
    private readonly _options: CacheOptions = {}
  ) {}

  private get _now(): number {
    return (this._options.now ?? Date.now)()
  }

  private get _maxAgeMs(): number {
    return this._options.maxAgeMs ?? DEFAULT_MAX_AGE_MS
  }

  async read<T>(prefix: string, key: CacheKey): Promise<T | undefined> {
    const name = cacheFileName(prefix, key)
    const raw = await this._storage.read(name)

    if (raw === undefined) {
      return undefined
    }

    let entry: CacheEntry<T>
    try {
      entry = JSON.parse(raw) as CacheEntry<T>
    } catch {
      // A truncated or corrupt entry is not worth diagnosing; drop it and refetch.
      await this._storage.remove(name)
      return undefined
    }

    if (!entry || typeof entry.storedAt !== 'number' || !entry.key) {
      await this._storage.remove(name)
      return undefined
    }

    // Guards against a stale file being served under a reused name.
    if (
      entry.key.patch !== key.patch ||
      entry.key.region !== key.region ||
      entry.key.tier !== key.tier
    ) {
      return undefined
    }

    if (this._now - entry.storedAt > this._maxAgeMs) {
      return undefined
    }

    return entry.value
  }

  async write<T>(prefix: string, key: CacheKey, value: T): Promise<void> {
    const entry: CacheEntry<T> = { key, storedAt: this._now, value }

    await this._storage.write(cacheFileName(prefix, key), JSON.stringify(entry))
  }

  async invalidate(prefix: string, key: CacheKey): Promise<void> {
    await this._storage.remove(cacheFileName(prefix, key))
  }
}

/** In-memory storage, for tests and for callers with no filesystem. */
export class MemoryCacheStorage implements CacheStorage {
  private readonly _entries = new Map<string, string>()

  async read(name: string): Promise<string | undefined> {
    return this._entries.get(name)
  }

  async write(name: string, contents: string): Promise<void> {
    this._entries.set(name, contents)
  }

  async remove(name: string): Promise<void> {
    this._entries.delete(name)
  }

  get size(): number {
    return this._entries.size
  }
}
