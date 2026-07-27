import { describe, expect, it } from 'vitest'

import {
  DatasetManifest,
  comparePatches,
  datasetFileName,
  resolveDataset
} from './dataset-manifest'

function entry(patch: string, region: string, tier: string) {
  return {
    patch,
    region,
    tier,
    file: datasetFileName(patch, region, tier),
    bytes: 1,
    champions: 1,
    matchups: 1,
    synergies: 1,
    generatedAt: '2026-07-27T00:00:00.000Z'
  }
}

const manifest: DatasetManifest = {
  schemaVersion: 1,
  generatedAt: '2026-07-27T00:00:00.000Z',
  datasets: [
    entry('16.9', 'kr', 'emerald_plus'),
    entry('16.14', 'kr', 'emerald_plus'),
    entry('16.14', 'global', 'emerald_plus'),
    entry('16.14', 'kr', 'master')
  ]
}

describe('comparePatches', () => {
  it('orders patches numerically, not lexically', () => {
    // The bug this exists to prevent: as strings, "16.9" sorts above "16.14", which would pin every
    // client to a five-patch-old dataset.
    expect(comparePatches('16.14', '16.9')).toBeGreaterThan(0)
    expect(comparePatches('16.9', '16.14')).toBeLessThan(0)
    expect(comparePatches('16.14', '16.14')).toBe(0)
    expect(comparePatches('17.1', '16.24')).toBeGreaterThan(0)
  })

  it('tolerates differing component counts and junk', () => {
    expect(comparePatches('16.14.1', '16.14')).toBeGreaterThan(0)
    expect(comparePatches('16', '16.0')).toBe(0)
    expect(comparePatches('', '16.1')).toBeLessThan(0)
  })
})

describe('datasetFileName', () => {
  it('is deterministic', () => {
    expect(datasetFileName('16.14', 'kr', 'emerald_plus')).toBe(
      'draft-stats-16.14-kr-emerald_plus.json.gz'
    )
  })

  it('sanitises values so a patch off the wire cannot escape the directory', () => {
    const name = datasetFileName('../../etc', 'kr', 'all')
    expect(name).not.toContain('/')
  })
})

describe('resolveDataset', () => {
  it('picks the newest patch for the requested scope', () => {
    expect(resolveDataset(manifest, 'kr', 'emerald_plus')?.patch).toBe('16.14')
  })

  it('honours an explicit patch', () => {
    expect(resolveDataset(manifest, 'kr', 'emerald_plus', '16.9')?.patch).toBe('16.9')
  })

  it('distinguishes region and tier', () => {
    expect(resolveDataset(manifest, 'global', 'emerald_plus')?.region).toBe('global')
    expect(resolveDataset(manifest, 'kr', 'master')?.tier).toBe('master')
  })

  it('returns undefined rather than a near miss', () => {
    // Silently serving euw data to a player who asked for kr would be worse than showing nothing.
    expect(resolveDataset(manifest, 'euw', 'emerald_plus')).toBeUndefined()
    expect(resolveDataset(manifest, 'kr', 'iron')).toBeUndefined()
    expect(resolveDataset(manifest, 'kr', 'emerald_plus', '99.1')).toBeUndefined()
  })

  it('handles an empty manifest', () => {
    expect(
      resolveDataset({ schemaVersion: 1, generatedAt: '', datasets: [] }, 'kr', 'all')
    ).toBeUndefined()
  })
})
