import type { DraftAdvisorResult, DraftStatsStatus } from '@shared/shards/draft-advisor'
import type { RegionType, TierType } from '@shared/types/opgg'
import { makeAutoObservable, observable } from 'mobx'

export class DraftAdvisorSettings {
  enabled: boolean = true

  /**
   * Which region's statistics to use.
   *
   * `global` rather than the player's own region by default, because the player's region may not
   * be one op.gg covers — notably every Tencent server. Picking a region the source does not have
   * would leave the advisor permanently empty.
   */
  region: RegionType = 'global'

  tier: TierType = 'emerald_plus'

  /** How many recommendations to surface. */
  limit: number = 8

  /**
   * Restrict recommendations to champions the player owns. On by default: a recommendation you
   * cannot pick is worse than no recommendation.
   */
  ownedOnly: boolean = true

  /**
   * Weight the player's own record with the champion into the score. This is the effect the
   * published tools omit, and on a champion you have never played it is larger than any matchup.
   */
  useProficiency: boolean = true

  setEnabled(value: boolean) {
    this.enabled = value
  }

  setRegion(value: RegionType) {
    this.region = value
  }

  setTier(value: TierType) {
    this.tier = value
  }

  setLimit(value: number) {
    this.limit = value
  }

  setOwnedOnly(value: boolean) {
    this.ownedOnly = value
  }

  setUseProficiency(value: boolean) {
    this.useProficiency = value
  }

  constructor() {
    makeAutoObservable(this)
  }
}

export class DraftAdvisorState {
  /** Latest recommendation, or null outside champion select. */
  result: DraftAdvisorResult | null = null

  /** Progress of the statistics load, which on a cold cache is a several-minute refresh. */
  statsStatus: DraftStatsStatus = { kind: 'idle' }

  setResult(result: DraftAdvisorResult | null) {
    this.result = result
  }

  setStatsStatus(status: DraftStatsStatus) {
    this.statsStatus = status
  }

  constructor() {
    makeAutoObservable(this, {
      result: observable.ref,
      statsStatus: observable.ref
    })
  }
}
