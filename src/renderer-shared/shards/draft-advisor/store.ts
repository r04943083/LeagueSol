import type { DraftAdvisorResult, DraftStatsStatus } from '@shared/shards/draft-advisor'
import type { RegionType, TierType } from '@shared/types/opgg'
import { defineStore } from 'pinia'
import { shallowReactive, shallowRef } from 'vue'

export const useDraftAdvisorStore = defineStore('shard:draft-advisor-renderer', () => {
  const settings = shallowReactive({
    enabled: true,
    region: 'global' as RegionType,
    tier: 'emerald_plus' as TierType,
    limit: 8,
    ownedOnly: true,
    useProficiency: true
  })

  const result = shallowRef<DraftAdvisorResult | null>(null)
  const statsStatus = shallowRef<DraftStatsStatus>({ kind: 'idle' })

  return { settings, result, statsStatus }
})
