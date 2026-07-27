import type { DraftStats } from '@shared/draft-engine'
import {
  DraftStatsCache,
  FsCacheStorage,
  assembleDraftStats,
  fetchChampionCatalog,
  fetchLatestPatch
} from '@shared/draft-data'
import { OpggHttpApiAxiosHelper } from '@shared/http-api-axios-helper/opgg'
import type { RegionType, TierType } from '@shared/types/opgg'
import axios from 'axios'
import { ProxyAgent, setGlobalDispatcher } from 'undici'

/**
 * Full patch refresh: pulls every champion's base rates, lane counters and duo synergies for one
 * region and tier, and writes the assembled statistics to the on-disk cache.
 *
 * This is several hundred requests against a free third-party service, so it runs at low
 * concurrency and is expected to be run once per patch, not per session.
 *
 *   yarn refresh-stats --region kr --tier emerald_plus
 */

interface Args {
  region: RegionType
  tier: TierType
  cacheDir: string
  concurrency: number
  minGames: number
}

function parseArgs(argv: string[]): Args {
  const args: Record<string, string> = {}

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (token.startsWith('--')) {
      const key = token.slice(2)
      const next = argv[i + 1]
      if (next !== undefined && !next.startsWith('--')) {
        args[key] = next
        i++
      } else {
        args[key] = 'true'
      }
    }
  }

  return {
    region: (args.region ?? 'kr') as RegionType,
    tier: (args.tier ?? 'emerald_plus') as TierType,
    cacheDir: args['cache-dir'] ?? '.cache/draft-stats',
    concurrency: Number(args.concurrency ?? 4),
    minGames: Number(args['min-games'] ?? 500)
  }
}

function summarise(stats: DraftStats): void {
  const games = (records: { games: number }[]) => records.reduce((s, r) => s + r.games, 0)

  const pairGames = [...stats.synergies, ...stats.matchups].map((r) => r.games).sort((a, b) => a - b)
  const median = pairGames.length ? pairGames[Math.floor(pairGames.length / 2)] : 0

  console.log(`\npatch ${stats.patch}  ${stats.region}/${stats.tier}`)
  console.log(`  champion/role rows : ${stats.champions.length}  (${games(stats.champions).toLocaleString()} games)`)
  console.log(`  matchup cells      : ${stats.matchups.length.toLocaleString()}`)
  console.log(`  synergy cells      : ${stats.synergies.length.toLocaleString()}`)
  console.log(`  median cell size   : ${median.toLocaleString()} games`)

  // The number that decides whether pair terms can carry any weight. Pinning a cell to +/-2%
  // needs ~2,400 games; well under that means shrinkage will dominate, by design.
  const thin = pairGames.filter((g) => g < 2400).length
  console.log(
    `  cells under 2,400g : ${thin.toLocaleString()} of ${pairGames.length.toLocaleString()} (${((thin / Math.max(pairGames.length, 1)) * 100).toFixed(1)}%)`
  )
}

async function main(): Promise<void> {
  const proxy =
    process.env.https_proxy ||
    process.env.HTTPS_PROXY ||
    process.env.http_proxy ||
    process.env.HTTP_PROXY
  if (proxy) {
    // Node's fetch, used by the synergy source, does not read the proxy environment on its own.
    setGlobalDispatcher(new ProxyAgent(proxy))
  }

  const args = parseArgs(process.argv.slice(2))
  // Leave `proxy` unset: axios reads http_proxy/https_proxy from the environment on its own, and
  // setting it to false would disable that. The undici dispatcher above covers the separate fetch
  // path used by the synergy source.
  const helper = new OpggHttpApiAxiosHelper(axios.create({ timeout: 30_000 }))
  const cache = new DraftStatsCache(new FsCacheStorage(args.cacheDir))

  console.log(`refreshing ${args.region}/${args.tier} into ${args.cacheDir}`)

  const catalog = await fetchChampionCatalog(await fetchLatestPatch())

  let lastStage = ''
  const started = Date.now()

  const stats = await assembleDraftStats(helper, {
    scope: { region: args.region, tier: args.tier },
    catalog,
    cache,
    minGames: args.minGames,
    concurrency: args.concurrency,
    onProgress: (stage, completed, total) => {
      if (stage !== lastStage) {
        lastStage = stage
        console.log(`\n${stage}:`)
      }
      if (completed % 25 === 0 || completed === total) {
        const elapsed = ((Date.now() - started) / 1000).toFixed(0)
        process.stdout.write(`  ${completed}/${total}  (${elapsed}s)\n`)
      }
    }
  })

  summarise(stats)
  console.log(`\ndone in ${((Date.now() - started) / 1000).toFixed(0)}s`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
