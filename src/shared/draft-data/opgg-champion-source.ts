import type { ChampionPairRecord, ChampionRoleRecord, Role } from '@shared/draft-engine'
import { OpggHttpApiAxiosHelper } from '@shared/http-api-axios-helper/opgg'
import type {
  OpggChampionPositionName,
  OpggChampionsResponse,
  PositionType,
  RegionType,
  TierType
} from '@shared/types/opgg'
import type { AxiosInstance } from 'axios'

/**
 * Champion base rates and lane counters from op.gg's champion API, reusing
 * {@link OpggHttpApiAxiosHelper} rather than a second HTTP client.
 *
 * The two tables come from different endpoints for a reason worth recording, because it is not
 * obvious and costs a lot of requests to rediscover:
 *
 *  - the **bulk** endpoint returns every champion's per-position play count and win rate in a
 *    single request, but only the top three counters per position — a preview, not the table
 *  - the **per-champion** endpoint returns the full ~50-entry counter list, at one request per
 *    champion *and position* (~260 in total)
 *
 * So base rates are cheap and counters are not. Counters should be fetched once per patch and
 * cached; op.gg's data policy permits use but reserves the right to restrict access for request
 * volumes that affect their service, which is why this module throttles rather than fanning out.
 */

const POSITION_TO_ROLE: Readonly<Record<string, Role>> = Object.freeze({
  TOP: 'top',
  JUNGLE: 'jungle',
  MID: 'mid',
  ADC: 'adc',
  SUPPORT: 'support'
})

const ROLE_TO_POSITION: Readonly<Record<Role, PositionType>> = Object.freeze({
  top: 'top',
  jungle: 'jungle',
  mid: 'mid',
  adc: 'adc',
  support: 'support'
})

export function positionToRole(position: OpggChampionPositionName | string): Role | undefined {
  return POSITION_TO_ROLE[position]
}

export function roleToPosition(role: Role): PositionType {
  return ROLE_TO_POSITION[role]
}

export interface OpggScope {
  region: RegionType
  tier: TierType
}

export interface ChampionRatesResult {
  /** Patch the statistics describe, straight from the response rather than assumed. */
  patch: string
  /** Total matches behind the aggregate, for reporting. */
  matchCount?: number
  records: ChampionRoleRecord[]
}

/**
 * Every champion's record in every position it is actually played, in one request.
 *
 * op.gg reports a win *rate*, not a win count. The engine needs counts to shrink, so the count is
 * reconstructed from the rate and the play count. That reconstruction is lossy at the margin — the
 * rate is rounded — but the error is a fraction of a game against sample sizes in the thousands.
 */
export async function fetchChampionRates(
  helper: OpggHttpApiAxiosHelper,
  scope: OpggScope,
  options: { signal?: AbortSignal } = {}
): Promise<ChampionRatesResult> {
  const response = await helper.getChampions(scope.region, 'ranked', {
    tier: scope.tier,
    signal: options.signal
  })

  const payload = response.data as OpggChampionsResponse
  const records: ChampionRoleRecord[] = []

  for (const champion of payload.data ?? []) {
    for (const position of champion.positions ?? []) {
      const role = positionToRole(position.name)
      if (!role) {
        continue
      }

      const games = position.stats.play
      if (!Number.isFinite(games) || games <= 0) {
        continue
      }

      records.push({
        championId: champion.id,
        role,
        games,
        wins: Math.round(games * position.stats.win_rate)
      })
    }
  }

  return {
    patch: String(payload.meta?.version ?? ''),
    matchCount: payload.meta?.match_count,
    records
  }
}

/**
 * The full lane counter table for one champion in one position.
 *
 * These are cross-team pairs from the champion's perspective, and op.gg scopes them to the same
 * lane — so `otherRole` is the champion's own role.
 */
export async function fetchCounters(
  helper: OpggHttpApiAxiosHelper,
  championId: number,
  role: Role,
  scope: OpggScope,
  options: { signal?: AbortSignal } = {}
): Promise<ChampionPairRecord[]> {
  const response = await helper.getChampion(
    scope.region,
    'ranked',
    championId,
    roleToPosition(role),
    { tier: scope.tier, signal: options.signal }
  )

  const counters = response.data?.data?.counters ?? []

  return counters
    .filter((c) => Number.isFinite(c.play) && c.play > 0)
    .map((counter) => ({
      championId,
      role,
      otherChampionId: counter.champion_id,
      otherRole: role,
      games: counter.play,
      wins: counter.win
    }))
}

export interface CounterFetchTarget {
  championId: number
  role: Role
}

export interface FetchAllCountersOptions {
  /**
   * Requests in flight. Kept low on purpose: this is ~260 requests against somebody else's free
   * service, and it only needs to run once per patch.
   */
  concurrency?: number
  signal?: AbortSignal
  onProgress?: (completed: number, total: number) => void
  /**
   * Called when a single champion fails. Defaults to skipping it — one unavailable champion should
   * degrade that champion's advice, not abort the whole refresh.
   */
  onError?: (target: CounterFetchTarget, error: unknown) => void
}

export async function fetchAllCounters(
  helper: OpggHttpApiAxiosHelper,
  targets: readonly CounterFetchTarget[],
  scope: OpggScope,
  options: FetchAllCountersOptions = {}
): Promise<ChampionPairRecord[]> {
  const { concurrency = 4, signal, onProgress, onError } = options

  const records: ChampionPairRecord[] = []
  let cursor = 0
  let completed = 0

  async function worker(): Promise<void> {
    for (;;) {
      const index = cursor++
      if (index >= targets.length || signal?.aborted) {
        return
      }

      const target = targets[index]
      try {
        records.push(
          ...(await fetchCounters(helper, target.championId, target.role, scope, { signal }))
        )
      } catch (error) {
        if (onError) {
          onError(target, error)
        }
      }

      onProgress?.(++completed, targets.length)
    }
  }

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrency, targets.length)) }, worker)
  )

  return records
}

/** Champion/role pairs worth fetching counters for, derived from the base rates. */
export function counterTargetsFrom(
  records: readonly ChampionRoleRecord[],
  minGames = 500
): CounterFetchTarget[] {
  return records
    .filter((r) => r.games >= minGames)
    .map((r) => ({ championId: r.championId, role: r.role }))
}

export function createOpggHelper(http: AxiosInstance): OpggHttpApiAxiosHelper {
  return new OpggHttpApiAxiosHelper(http)
}
