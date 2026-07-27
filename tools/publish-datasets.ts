import {
  DATASET_MANIFEST_NAME,
  DATASET_SCHEMA_VERSION,
  DatasetEntry,
  DatasetManifest,
  DraftStatsCache,
  FsCacheStorage,
  assembleDraftStats,
  datasetFileName,
  fetchChampionCatalog,
  fetchLatestPatch
} from '@shared/draft-data'
import type { DraftStats } from '@shared/draft-engine'
import { OpggHttpApiAxiosHelper } from '@shared/http-api-axios-helper/opgg'
import type { RegionType, TierType } from '@shared/types/opgg'
import axios from 'axios'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { ProxyAgent, setGlobalDispatcher } from 'undici'

/**
 * Assembles datasets for every published scope and writes them, gzipped, alongside a manifest.
 *
 * Intended to run in CI once per patch. The whole reason it exists is so that no installation ever
 * has to do this work: the output is a handful of ~130 KB files that clients download in one
 * request each.
 *
 *   yarn publish-datasets --scopes global:emerald_plus,kr:emerald_plus --out dist-datasets
 */

interface Scope {
  region: RegionType
  tier: TierType
}

const DEFAULT_SCOPES: Scope[] = [
  // `global` first: it is the only sensible default for players on servers op.gg does not cover,
  // which includes every Tencent shard.
  { region: 'global', tier: 'emerald_plus' },
  { region: 'kr', tier: 'emerald_plus' }
]

function parseArgs(argv: string[]) {
  const raw: Record<string, string> = {}
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const next = argv[i + 1]
      if (next !== undefined && !next.startsWith('--')) {
        raw[argv[i].slice(2)] = next
        i++
      } else {
        raw[argv[i].slice(2)] = 'true'
      }
    }
  }

  const scopes: Scope[] = raw.scopes
    ? raw.scopes.split(',').map((token) => {
        const [region, tier] = token.split(':')
        if (!region || !tier) {
          throw new Error(`--scopes entries must be region:tier, received ${token}`)
        }
        return { region: region as RegionType, tier: tier as TierType }
      })
    : DEFAULT_SCOPES

  return {
    scopes,
    out: raw.out ?? 'dist-datasets',
    cacheDir: raw['cache-dir'] ?? '.cache/draft-stats',
    concurrency: Number(raw.concurrency ?? 4)
  }
}

async function main(): Promise<void> {
  const proxy =
    process.env.https_proxy ||
    process.env.HTTPS_PROXY ||
    process.env.http_proxy ||
    process.env.HTTP_PROXY
  if (proxy) {
    setGlobalDispatcher(new ProxyAgent(proxy))
  }

  const args = parseArgs(process.argv.slice(2))
  const helper = new OpggHttpApiAxiosHelper(axios.create({ timeout: 30_000 }))
  const cache = new DraftStatsCache(new FsCacheStorage(args.cacheDir), {
    maxAgeMs: Number.MAX_SAFE_INTEGER
  })

  await mkdir(args.out, { recursive: true })

  const catalog = await fetchChampionCatalog(await fetchLatestPatch())
  const entries: DatasetEntry[] = []
  const failures: string[] = []

  for (const scope of args.scopes) {
    const label = `${scope.region}/${scope.tier}`
    console.log(`\n=== ${label} ===`)

    let stats: DraftStats
    try {
      stats = await assembleDraftStats(helper, {
        scope,
        catalog,
        cache,
        concurrency: args.concurrency,
        onProgress: (stage, completed, total) => {
          if (completed % 50 === 0 || completed === total) {
            console.log(`  ${stage}: ${completed}/${total}`)
          }
        }
      })
    } catch (error) {
      // One bad scope should not cost the whole run; the manifest simply omits it and clients fall
      // back to another scope.
      console.error(`  FAILED: ${error}`)
      failures.push(label)
      continue
    }

    const file = datasetFileName(stats.patch, stats.region, stats.tier)
    const compressed = gzipSync(Buffer.from(JSON.stringify(stats), 'utf8'), { level: 9 })
    await writeFile(join(args.out, file), compressed)

    entries.push({
      patch: stats.patch,
      region: stats.region,
      tier: stats.tier,
      file,
      bytes: compressed.byteLength,
      champions: stats.champions.length,
      matchups: stats.matchups.length,
      synergies: stats.synergies.length,
      generatedAt: new Date().toISOString()
    })

    console.log(
      `  wrote ${file} (${(compressed.byteLength / 1024).toFixed(0)} KB) — ` +
        `patch ${stats.patch}, ${stats.matchups.length} matchups, ${stats.synergies.length} synergies`
    )
  }

  if (entries.length === 0) {
    throw new Error('no datasets were produced; refusing to publish an empty manifest')
  }

  const manifest: DatasetManifest = {
    schemaVersion: DATASET_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    datasets: entries
  }

  await writeFile(join(args.out, DATASET_MANIFEST_NAME), JSON.stringify(manifest, null, 2))

  console.log(`\nmanifest: ${entries.length} dataset(s) in ${args.out}`)
  if (failures.length) {
    console.log(`skipped: ${failures.join(', ')}`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
