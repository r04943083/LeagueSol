import {
  DraftStatsCache,
  FsCacheStorage,
  assembleDraftStats,
  fetchChampionCatalog,
  fetchLatestPatch
} from '@shared/draft-data'
import { DraftModel } from '@shared/draft-engine'
import { OpggHttpApiAxiosHelper } from '@shared/http-api-axios-helper/opgg'
import type { DraftStatsStatus } from '@shared/shards/draft-advisor'
import type { RegionType, TierType } from '@shared/types/opgg'
import axios from 'axios'
import { app } from 'electron'
import { join } from 'node:path'

import type { AkariLogger } from '../logger-factory'

/**
 * Supplies the compiled model champion select needs.
 *
 * The important constraint is that a cold refresh is roughly 680 requests and takes minutes, which
 * is far longer than a champion-select phase. So a refresh never happens on the critical path: the
 * provider serves whatever is cached, and a miss starts a background refresh that a later draft
 * will benefit from. Advice arriving one game late is a great deal better than a draft panel that
 * blocks for six minutes.
 */
export class DraftStatsProvider {
  private readonly _cache: DraftStatsCache
  private readonly _helper: OpggHttpApiAxiosHelper
  private _model: DraftModel | null = null
  private _refreshing: Promise<void> | null = null

  constructor(
    private readonly _logger: AkariLogger,
    private readonly _onStatus: (status: DraftStatsStatus) => void,
    cacheDirectory = join(app.getPath('userData'), 'draft-stats')
  ) {
    this._cache = new DraftStatsCache(new FsCacheStorage(cacheDirectory), {
      // Statistics stay usable until the patch changes. Expiring them mid-patch would only strand
      // the advisor behind another multi-minute refresh for a marginal freshness gain.
      maxAgeMs: Number.MAX_SAFE_INTEGER
    })
    this._helper = new OpggHttpApiAxiosHelper(axios.create({ timeout: 30_000 }))
  }

  get model(): DraftModel | null {
    return this._model
  }

  /**
   * Returns the model if one is loaded, otherwise starts a background refresh and returns null.
   * Never blocks on the network.
   */
  ensure(region: RegionType, tier: TierType): DraftModel | null {
    if (this._model && this._model.region === region && this._model.tier === tier) {
      return this._model
    }

    if (!this._refreshing) {
      this._refreshing = this._load(region, tier).finally(() => {
        this._refreshing = null
      })
    }

    return null
  }

  private async _load(region: RegionType, tier: TierType): Promise<void> {
    try {
      this._onStatus({ kind: 'loading', stage: 'champion rates', completed: 0, total: 0 })

      const catalog = await fetchChampionCatalog(await fetchLatestPatch())

      const stats = await assembleDraftStats(this._helper, {
        scope: { region, tier },
        catalog,
        cache: this._cache,
        onProgress: (stage, completed, total) => {
          this._onStatus({ kind: 'loading', stage, completed, total })
        }
      })

      this._model = DraftModel.compile(stats)
      this._onStatus({ kind: 'ready', patch: stats.patch, region: stats.region, tier: stats.tier })
      this._logger.info(
        `draft statistics ready: patch ${stats.patch} ${region}/${tier}, ` +
          `${stats.champions.length} champion rows, ${stats.matchups.length} matchups, ` +
          `${stats.synergies.length} synergies`
      )
    } catch (error) {
      this._logger.warn(`failed to load draft statistics: ${error}`)
      this._onStatus({
        kind: 'error',
        message: error instanceof Error ? error.message : String(error)
      })
    }
  }
}
