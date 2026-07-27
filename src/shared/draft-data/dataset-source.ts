import type { DraftStats } from '@shared/draft-engine'
import { gunzipSync } from 'node:zlib'

import {
  DATASET_MANIFEST_NAME,
  DATASET_SCHEMA_VERSION,
  DatasetEntry,
  DatasetManifest,
  resolveDataset
} from './dataset-manifest'

/**
 * Downloads statistics that were assembled once, in CI, rather than assembling them here.
 *
 * This is the path every installation should take. A client makes one request for a manifest and
 * one for a ~130 KB gzipped dataset, instead of ~680 requests spread over several minutes against
 * somebody else's free service.
 */

/**
 * Rolling release tag: the URL stays stable while the assets behind it are replaced each patch, so
 * a shipped binary never needs to know which patch is current.
 */
export const DEFAULT_DATASET_BASE_URL =
  'https://github.com/r04943083/LeagueSol/releases/download/datasets'

export interface DatasetSourceOptions {
  baseUrl?: string
  fetchImpl?: typeof fetch
  signal?: AbortSignal
}

export async function fetchDatasetManifest(
  options: DatasetSourceOptions = {}
): Promise<DatasetManifest> {
  const { baseUrl = DEFAULT_DATASET_BASE_URL, fetchImpl = fetch, signal } = options

  const response = await fetchImpl(`${baseUrl}/${DATASET_MANIFEST_NAME}`, { signal })

  if (!response.ok) {
    throw new Error(`dataset manifest request failed: ${response.status}`)
  }

  const manifest = (await response.json()) as DatasetManifest

  if (manifest?.schemaVersion !== DATASET_SCHEMA_VERSION) {
    // A newer publisher than this build understands. Refusing is better than misreading fields.
    throw new Error(
      `unsupported dataset schema ${manifest?.schemaVersion}, expected ${DATASET_SCHEMA_VERSION}`
    )
  }

  if (!Array.isArray(manifest.datasets)) {
    throw new Error('dataset manifest contains no dataset list')
  }

  return manifest
}

export async function downloadDataset(
  entry: DatasetEntry,
  options: DatasetSourceOptions = {}
): Promise<DraftStats> {
  const { baseUrl = DEFAULT_DATASET_BASE_URL, fetchImpl = fetch, signal } = options

  const response = await fetchImpl(`${baseUrl}/${entry.file}`, { signal })

  if (!response.ok) {
    throw new Error(`dataset request failed: ${response.status}`)
  }

  const compressed = Buffer.from(await response.arrayBuffer())
  const stats = JSON.parse(gunzipSync(compressed).toString('utf8')) as DraftStats

  // The manifest is the only thing a client sees before downloading, so a disagreement between it
  // and the payload means one of them is stale. Better to fail than to report a patch we do not
  // actually hold.
  if (stats.patch !== entry.patch || stats.region !== entry.region || stats.tier !== entry.tier) {
    throw new Error(
      `dataset contents disagree with the manifest: expected ${entry.patch}/${entry.region}/${entry.tier}, ` +
        `received ${stats.patch}/${stats.region}/${stats.tier}`
    )
  }

  return stats
}

/**
 * Manifest plus download in one step, for the common case.
 */
export async function fetchPublishedStats(
  region: string,
  tier: string,
  options: DatasetSourceOptions & { patch?: string } = {}
): Promise<DraftStats> {
  const manifest = await fetchDatasetManifest(options)
  const entry = resolveDataset(manifest, region, tier, options.patch)

  if (!entry) {
    const available = manifest.datasets.map((d) => `${d.region}/${d.tier}`).join(', ') || 'none'
    throw new Error(
      `no published dataset for ${region}/${tier}${options.patch ? ` on patch ${options.patch}` : ''}. available: ${available}`
    )
  }

  return downloadDataset(entry, options)
}
