/**
 * Fetching, parsing and caching of the statistics the draft engine consumes.
 *
 * The split from `@shared/draft-engine` is enforced in one direction only: this package imports the
 * engine's types, and the engine imports nothing from here. That is what keeps the engine testable
 * without a network.
 */

export { DraftStatsCache, MemoryCacheStorage, cacheFileName } from './cache'
export type { CacheEntry, CacheKey, CacheOptions, CacheStorage } from './cache'

export { FsCacheStorage } from './fs-cache-storage'

export {
  fetchChampionCatalog,
  fetchLatestPatch,
  toMcpChampionName
} from './champion-static'
export type { ChampionCatalog, ChampionIdentity } from './champion-static'

export {
  counterTargetsFrom,
  createOpggHelper,
  fetchAllCounters,
  fetchChampionRates,
  fetchCounters,
  positionToRole,
  roleToPosition
} from './opgg-champion-source'
export type {
  ChampionRatesResult,
  CounterFetchTarget,
  FetchAllCountersOptions,
  OpggScope
} from './opgg-champion-source'

export { SYNERGY_ROLE_PAIRS, fetchSynergies, parseMcpEnvelope, toSynergyRecords } from './opgg-synergy-source'
export type { McpClientOptions, SynergyQuery } from './opgg-synergy-source'

export { ReprParseError, parseRepr } from './repr-parser'
export type { ReprObject, ReprValue } from './repr-parser'

export { assembleDraftStats, fetchAllSynergies } from './stats-assembler'
export type { AssembleOptions } from './stats-assembler'
