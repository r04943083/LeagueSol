import { describe, expect, it } from 'vitest'

import { CacheKey, DraftStatsCache, MemoryCacheStorage, cacheFileName } from './cache'

const KEY: CacheKey = { patch: '16.14', region: 'kr', tier: 'emerald_plus' }

describe('cacheFileName', () => {
  it('includes patch, region and tier', () => {
    expect(cacheFileName('draft-stats', KEY)).toBe('draft-stats__16.14__kr__emerald_plus.json')
  })

  it('sanitises a patch that arrived off the wire', () => {
    const name = cacheFileName('draft-stats', { ...KEY, patch: '../../etc/passwd' })
    expect(name).not.toContain('/')
    expect(name).not.toContain('../')
  })

  it('distinguishes scopes that differ in only one field', () => {
    const a = cacheFileName('draft-stats', KEY)
    const b = cacheFileName('draft-stats', { ...KEY, tier: 'diamond_plus' })
    const c = cacheFileName('draft-stats', { ...KEY, region: 'euw' })

    expect(new Set([a, b, c]).size).toBe(3)
  })
})

describe('DraftStatsCache', () => {
  it('round-trips a value', async () => {
    const cache = new DraftStatsCache(new MemoryCacheStorage())
    await cache.write('draft-stats', KEY, { champions: [1, 2, 3] })

    expect(await cache.read('draft-stats', KEY)).toEqual({ champions: [1, 2, 3] })
  })

  it('misses on a different patch', async () => {
    // The property the whole design exists for: last patch's counters must never be served against
    // this patch's draft.
    const cache = new DraftStatsCache(new MemoryCacheStorage())
    await cache.write('draft-stats', KEY, { marker: 'old' })

    expect(await cache.read('draft-stats', { ...KEY, patch: '16.15' })).toBeUndefined()
  })

  it('misses on a different region or tier', async () => {
    const cache = new DraftStatsCache(new MemoryCacheStorage())
    await cache.write('draft-stats', KEY, { marker: 'kr' })

    expect(await cache.read('draft-stats', { ...KEY, region: 'euw' })).toBeUndefined()
    expect(await cache.read('draft-stats', { ...KEY, tier: 'master' })).toBeUndefined()
  })

  it('expires an entry once it is older than the maximum age', async () => {
    let now = 1_000_000
    const cache = new DraftStatsCache(new MemoryCacheStorage(), {
      maxAgeMs: 1000,
      now: () => now
    })

    await cache.write('draft-stats', KEY, { marker: 'fresh' })
    expect(await cache.read('draft-stats', KEY)).toEqual({ marker: 'fresh' })

    now += 1001
    expect(await cache.read('draft-stats', KEY)).toBeUndefined()
  })

  it('returns undefined for an absent entry', async () => {
    const cache = new DraftStatsCache(new MemoryCacheStorage())
    expect(await cache.read('draft-stats', KEY)).toBeUndefined()
  })

  it('drops a corrupt entry instead of throwing', async () => {
    const storage = new MemoryCacheStorage()
    await storage.write(cacheFileName('draft-stats', KEY), '{ this is not json')
    const cache = new DraftStatsCache(storage)

    expect(await cache.read('draft-stats', KEY)).toBeUndefined()
    expect(storage.size).toBe(0)
  })

  it('rejects an entry whose stored key disagrees with the requested one', async () => {
    // Defends against a file surviving a change in the naming scheme.
    const storage = new MemoryCacheStorage()
    await storage.write(
      cacheFileName('draft-stats', KEY),
      JSON.stringify({ key: { ...KEY, patch: '16.01' }, storedAt: Date.now(), value: { x: 1 } })
    )
    const cache = new DraftStatsCache(storage)

    expect(await cache.read('draft-stats', KEY)).toBeUndefined()
  })

  it('invalidates on request', async () => {
    const cache = new DraftStatsCache(new MemoryCacheStorage())
    await cache.write('draft-stats', KEY, { marker: 'x' })
    await cache.invalidate('draft-stats', KEY)

    expect(await cache.read('draft-stats', KEY)).toBeUndefined()
  })
})
