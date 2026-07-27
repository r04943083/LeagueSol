import type { ChampionPairRecord, DraftStats } from '@shared/draft-engine'
import { OpggHttpApiAxiosHelper } from '@shared/http-api-axios-helper/opgg'

import { CacheKey, DraftStatsCache } from './cache'
import { ChampionCatalog, toMcpChampionName } from './champion-static'
import {
  CounterFetchTarget,
  OpggScope,
  counterTargetsFrom,
  fetchAllCounters,
  fetchChampionRates
} from './opgg-champion-source'
import { SYNERGY_ROLE_PAIRS, fetchSynergies } from './opgg-synergy-source'

/**
 * Assembles a complete {@link DraftStats} from the three upstream sources.
 *
 * The ordering is not arbitrary: base rates come first because they are one cheap request and they
 * determine which champion/role combinations are worth spending the expensive per-champion counter
 * requests on. Fetching counters for every champion in every role would triple the request count to
 * describe combinations nobody plays.
 */

export interface AssembleOptions {
  scope: OpggScope
  catalog: ChampionCatalog
  cache?: DraftStatsCache
  /** Minimum games for a champion/role to be worth fetching counters and synergies for. */
  minGames?: number
  concurrency?: number
  signal?: AbortSignal
  onProgress?: (stage: string, completed: number, total: number) => void
}

const CACHE_PREFIX = 'draft-stats'

export async function assembleDraftStats(
  helper: OpggHttpApiAxiosHelper,
  options: AssembleOptions
): Promise<DraftStats> {
  const { scope, catalog, cache, minGames = 500, concurrency = 4, signal, onProgress } = options

  // Base rates double as the patch probe: op.gg reports which patch it is describing, and every
  // downstream cache entry is keyed on that rather than on whatever the client believes.
  const rates = await fetchChampionRates(helper, scope, { signal })

  const key: CacheKey = {
    patch: rates.patch,
    region: String(scope.region),
    tier: String(scope.tier)
  }

  const cached = await cache?.read<DraftStats>(CACHE_PREFIX, key)
  if (cached) {
    return cached
  }

  const targets = counterTargetsFrom(rates.records, minGames)

  onProgress?.('counters', 0, targets.length)
  const matchups = await fetchAllCounters(helper, targets, scope, {
    concurrency,
    signal,
    onProgress: (done, total) => onProgress?.('counters', done, total)
  })

  const synergies = await fetchAllSynergies(targets, catalog, {
    concurrency,
    signal,
    onProgress: (done, total) => onProgress?.('synergies', done, total)
  })

  const stats: DraftStats = {
    patch: rates.patch,
    region: String(scope.region),
    tier: String(scope.tier),
    champions: rates.records,
    synergies,
    matchups
  }

  await cache?.write(CACHE_PREFIX, key, stats)

  return stats
}

interface SynergyFetchOptions {
  concurrency?: number
  signal?: AbortSignal
  onProgress?: (completed: number, total: number) => void
  onError?: (target: CounterFetchTarget, error: unknown) => void
}

/**
 * Synergy for every champion/role that has a modelled partner role.
 *
 * Only the pairings in {@link SYNERGY_ROLE_PAIRS} are queried — top/ADC interaction is mostly noise
 * and spending requests on it would add nothing.
 */
export async function fetchAllSynergies(
  targets: readonly CounterFetchTarget[],
  catalog: ChampionCatalog,
  options: SynergyFetchOptions = {}
): Promise<ChampionPairRecord[]> {
  const { concurrency = 4, signal, onProgress, onError } = options

  const jobs: { target: CounterFetchTarget; partnerRole: CounterFetchTarget['role'] }[] = []
  for (const target of targets) {
    for (const [role, partnerRole] of SYNERGY_ROLE_PAIRS) {
      if (role === target.role) {
        jobs.push({ target, partnerRole })
      }
    }
  }

  const records: ChampionPairRecord[] = []
  let cursor = 0
  let completed = 0

  async function worker(): Promise<void> {
    for (;;) {
      const index = cursor++
      if (index >= jobs.length || signal?.aborted) {
        return
      }

      const { target, partnerRole } = jobs[index]
      const identity = catalog.byId.get(target.championId)

      if (identity) {
        try {
          records.push(
            ...(await fetchSynergies(
              {
                champion: toMcpChampionName(identity.key),
                championId: target.championId,
                role: target.role,
                partnerRole
              },
              { signal }
            ))
          )
        } catch (error) {
          onError?.(target, error)
        }
      }

      onProgress?.(++completed, jobs.length)
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, jobs.length)) }, worker))

  return records
}
