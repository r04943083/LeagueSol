import type { Recommendation, Role } from '@shared/draft-engine'

/** Shape shared between the main process and the renderer. */

export interface DraftAdvisorRecommendation extends Recommendation {
  /** Whether the local player owns this champion. */
  owned: boolean
  /** The local player's mastery points, when known. */
  masteryPoints: number
}

export interface DraftAdvisorResult {
  role: Role
  patch: string
  region: string
  tier: string
  /**
   * Which region the statistics describe. On Tencent servers this is never the player's own
   * region, because op.gg publishes no China data, and the UI is expected to say so rather than
   * present foreign numbers as local ones.
   */
  statisticsAreForeign: boolean
  recommendations: DraftAdvisorRecommendation[]
  generatedAt: number
}

export type DraftStatsStatus =
  | { kind: 'idle' }
  | { kind: 'loading'; stage: string; completed: number; total: number }
  | { kind: 'ready'; patch: string; region: string; tier: string }
  | { kind: 'error'; message: string }
