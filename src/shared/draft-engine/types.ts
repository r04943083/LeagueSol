export const ROLES = ['top', 'jungle', 'mid', 'adc', 'support'] as const

export type Role = (typeof ROLES)[number]

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value)
}

/** A champion's overall record in one role. */
export interface ChampionRoleRecord {
  championId: number
  role: Role
  games: number
  wins: number
}

/**
 * A record for two champions appearing together, always from `championId`'s perspective: `wins` is
 * the number of games *`championId`'s team* won. Used for both same-team synergy and cross-team
 * matchups; which one it is depends on the table it lives in, not on the shape.
 */
export interface ChampionPairRecord {
  championId: number
  role: Role
  otherChampionId: number
  otherRole: Role
  games: number
  wins: number
}

/**
 * Everything the engine needs, already scoped to one patch/region/tier. Assembling this is the
 * data layer's job; the engine never fetches.
 */
export interface DraftStats {
  patch: string
  region: string
  tier: string
  champions: ChampionRoleRecord[]
  /** Same-team pairs. */
  synergies: ChampionPairRecord[]
  /** Cross-team pairs, from the ally champion's perspective. */
  matchups: ChampionPairRecord[]
}

/** One champion already locked into a draft. */
export interface DraftPick {
  championId: number
  role: Role
}

export interface DraftState {
  /** Locked allies, excluding the slot being filled. */
  allies: DraftPick[]
  enemies: DraftPick[]
  /** The role the recommendation is for. */
  role: Role
}

/** A single named term in a recommendation's total, in rating points. */
export interface ScoreContribution {
  kind: 'base' | 'synergy' | 'matchup'
  /** The other champion involved, absent for the base term. */
  otherChampionId?: number
  otherRole?: Role
  /** Rating points contributed. Signed: negative means this term hurt the pick. */
  rating: number
  /** Games backing the underlying cell, before shrinkage. */
  games: number
  /**
   * Share of this term driven by observation rather than the prior, in [0, 1]. A term with a large
   * rating and a low evidence weight is a term the engine is guessing at.
   */
  evidence: number
}

export interface Recommendation {
  championId: number
  role: Role
  /** Total rating, comparable across candidates for the same draft state. */
  rating: number
  /**
   * The draft-implied win rate for this pick. Only an estimate of the draft's contribution — it
   * says nothing about how the game is actually played.
   */
  winrate: number
  contributions: ScoreContribution[]
}
