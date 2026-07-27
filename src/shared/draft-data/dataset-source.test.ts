import { gzipSync } from 'node:zlib'
import { describe, expect, it, vi } from 'vitest'

import { datasetFileName } from './dataset-manifest'
import { downloadDataset, fetchDatasetManifest, fetchPublishedStats } from './dataset-source'

const STATS = {
  patch: '16.14',
  region: 'kr',
  tier: 'emerald_plus',
  champions: [{ championId: 1, role: 'top', games: 100, wins: 50 }],
  synergies: [],
  matchups: []
}

function entry(overrides: Record<string, unknown> = {}) {
  return {
    patch: '16.14',
    region: 'kr',
    tier: 'emerald_plus',
    file: datasetFileName('16.14', 'kr', 'emerald_plus'),
    bytes: 1,
    champions: 1,
    matchups: 0,
    synergies: 0,
    generatedAt: '2026-07-27T00:00:00.000Z',
    ...overrides
  }
}

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as unknown as Response
}

function gzipResponse(body: unknown) {
  const buffer = gzipSync(Buffer.from(JSON.stringify(body), 'utf8'))
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () =>
      buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
  } as unknown as Response
}

describe('fetchDatasetManifest', () => {
  it('reads a manifest', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ schemaVersion: 1, generatedAt: '', datasets: [entry()] }))

    const manifest = await fetchDatasetManifest({ baseUrl: 'https://example.test', fetchImpl })

    expect(manifest.datasets).toHaveLength(1)
    expect(fetchImpl).toHaveBeenCalledWith('https://example.test/index.json', expect.anything())
  })

  it('refuses a schema it does not understand', async () => {
    // A newer publisher may have moved fields; misreading them would be worse than failing.
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ schemaVersion: 2, generatedAt: '', datasets: [] }))

    await expect(fetchDatasetManifest({ fetchImpl })).rejects.toThrow(/unsupported dataset schema/)
  })

  it('reports a failed request', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, false, 404))
    await expect(fetchDatasetManifest({ fetchImpl })).rejects.toThrow(/404/)
  })

  it('rejects a manifest with no dataset list', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ schemaVersion: 1, generatedAt: '' }))
    await expect(fetchDatasetManifest({ fetchImpl })).rejects.toThrow(/no dataset list/)
  })
})

describe('downloadDataset', () => {
  it('decompresses and returns the statistics', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(gzipResponse(STATS))

    const stats = await downloadDataset(entry(), { baseUrl: 'https://example.test', fetchImpl })

    expect(stats.patch).toBe('16.14')
    expect(stats.champions).toHaveLength(1)
  })

  it('rejects a payload that disagrees with the manifest', async () => {
    // The manifest is all a client sees before downloading. If the two disagree one is stale, and
    // reporting a patch we do not actually hold would mislabel every recommendation.
    const fetchImpl = vi.fn().mockResolvedValue(gzipResponse({ ...STATS, patch: '16.13' }))

    await expect(downloadDataset(entry(), { fetchImpl })).rejects.toThrow(/disagree/)
  })

  it('reports a failed download', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 503 } as Response)
    await expect(downloadDataset(entry(), { fetchImpl })).rejects.toThrow(/503/)
  })
})

describe('fetchPublishedStats', () => {
  it('resolves the manifest then downloads', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ schemaVersion: 1, generatedAt: '', datasets: [entry()] })
      )
      .mockResolvedValueOnce(gzipResponse(STATS))

    const stats = await fetchPublishedStats('kr', 'emerald_plus', { fetchImpl })

    expect(stats.region).toBe('kr')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('names the available scopes when the requested one is missing', async () => {
    // Turns an opaque failure into an actionable one: the fallback path logs this message.
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ schemaVersion: 1, generatedAt: '', datasets: [entry()] }))

    await expect(fetchPublishedStats('euw', 'master', { fetchImpl })).rejects.toThrow(
      /available: kr\/emerald_plus/
    )
  })
})
