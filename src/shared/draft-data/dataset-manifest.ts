/**
 * The contract between the dataset publisher and the client.
 *
 * A published dataset is one patch/region/tier of assembled statistics, gzipped. The manifest lists
 * what is available so a client can resolve the right file without guessing at URLs.
 *
 * The point of the whole arrangement: assembling a dataset costs ~680 requests against op.gg and
 * several minutes. Doing that in every installation would multiply the load by the user count and
 * get the app blocked — deservedly, since op.gg's data policy reserves the right to restrict access
 * for request volumes that affect their service. Assembling once per patch in CI and shipping the
 * result turns a per-user cost into a per-patch one, and turns a six-minute wait into a 130 KB
 * download.
 */

export const DATASET_MANIFEST_NAME = 'index.json'

export const DATASET_SCHEMA_VERSION = 1

export interface DatasetEntry {
  patch: string
  region: string
  tier: string
  /** File name of the gzipped dataset, relative to the manifest. */
  file: string
  /** Compressed size, so a client can report progress before downloading. */
  bytes: number
  /** Row counts, for display and for spotting a truncated build. */
  champions: number
  matchups: number
  synergies: number
  generatedAt: string
}

export interface DatasetManifest {
  schemaVersion: number
  generatedAt: string
  datasets: DatasetEntry[]
}

export function datasetFileName(patch: string, region: string, tier: string): string {
  const safe = (value: string) => value.replace(/[^a-zA-Z0-9._-]/g, '_')

  return `draft-stats-${safe(patch)}-${safe(region)}-${safe(tier)}.json.gz`
}

/**
 * Picks the best available dataset for a region and tier, preferring the newest patch.
 *
 * Patches are compared numerically per component rather than as strings, because `16.9` must not
 * sort above `16.14`.
 */
export function resolveDataset(
  manifest: DatasetManifest,
  region: string,
  tier: string,
  patch?: string
): DatasetEntry | undefined {
  const candidates = manifest.datasets.filter(
    (d) => d.region === region && d.tier === tier && (patch === undefined || d.patch === patch)
  )

  if (candidates.length === 0) {
    return undefined
  }

  return candidates.sort((a, b) => comparePatches(b.patch, a.patch))[0]
}

export function comparePatches(a: string, b: string): number {
  const parse = (patch: string) => patch.split('.').map((part) => Number(part) || 0)
  const left = parse(a)
  const right = parse(b)

  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0)
    if (diff !== 0) {
      return diff
    }
  }

  return 0
}
