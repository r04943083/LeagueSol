import type { DraftModel } from './model'
import { winrateToRating } from './rating'
import { shrinkWinrate } from './shrinkage'
import type { Role } from './types'

/**
 * Every published draft tool shares one blind spot, and both DraftGap and LoLDraftAI say so
 * outright: they rank champions by how well the champion performs, not by how well *you* perform
 * on it. A recommendation to pick the statistically optimal jungler is worthless if you have four
 * games on it.
 *
 * Closing that gap needs no modelling advances at all — the client already knows which champions
 * you own and how much you have played them. It is plainly a larger effect than the ~1 point of
 * accuracy separating the published pairwise and neural models.
 */

/** What the client knows about one champion in the player's pool. */
export interface ChampionProficiency {
  championId: number
  /** Whether the champion can actually be picked. */
  owned: boolean
  /** The player's games on this champion in the role under consideration. */
  games: number
  /** The player's own wins on it. Omit when unknown; the champion is then treated as unproven. */
  wins?: number
}

export interface CandidateOptions {
  /**
   * Champions with fewer games than this are dropped entirely. Set to 0 to keep everything and
   * rely on the rating penalty alone.
   */
  minGames?: number
  /**
   * Prior weight, in games, for blending the player's win rate toward the champion's global rate.
   * Personal samples are tiny — a few dozen games — so this is doing real work.
   */
  proficiencyConcentration?: number
  /**
   * Rating penalty applied at zero games, decaying as games accumulate. Represents execution risk
   * rather than champion strength: an unfamiliar champion underperforms its statistics.
   */
  unfamiliarityPenalty?: number
  /** Games at which the unfamiliarity penalty has decayed to roughly a third. */
  familiarityScale?: number
}

const DEFAULT_CANDIDATE_OPTIONS: Required<CandidateOptions> = {
  minGames: 0,
  proficiencyConcentration: 60,
  unfamiliarityPenalty: 60,
  familiarityScale: 25
}

/**
 * Champions the player can actually pick in this role, ordered as supplied.
 */
export function buildCandidatePool(
  proficiencies: readonly ChampionProficiency[],
  options: CandidateOptions = {}
): number[] {
  const { minGames } = { ...DEFAULT_CANDIDATE_OPTIONS, ...options }

  return proficiencies.filter((p) => p.owned && p.games >= minGames).map((p) => p.championId)
}

/**
 * A rating adjustment in the same units as every other term, so it can simply be added.
 *
 * Two separate effects are folded in:
 *
 *  - **Skill**: how the player's own record on the champion compares to the global record, shrunk
 *    hard toward the global rate because personal samples are small.
 *  - **Unfamiliarity**: a penalty that decays with games played. This is deliberately *not*
 *    symmetric — having played a champion a lot does not make it stronger, but never having
 *    played it does make it riskier.
 */
export function proficiencyAdjustment(
  model: DraftModel,
  proficiency: ChampionProficiency,
  role: Role,
  options: CandidateOptions = {}
): number {
  const opts = { ...DEFAULT_CANDIDATE_OPTIONS, ...options }

  const unfamiliarity =
    -opts.unfamiliarityPenalty * Math.exp(-proficiency.games / opts.familiarityScale)

  if (proficiency.wins === undefined || proficiency.games === 0) {
    return unfamiliarity
  }

  const globalRating = model.championRating(proficiency.championId, role)
  const globalWinrate = model.hasChampion(proficiency.championId, role)
    ? 1 / (1 + Math.pow(10, -globalRating / 400))
    : 0.5

  const personalWinrate = shrinkWinrate(
    { games: proficiency.games, wins: proficiency.wins, priorMean: globalWinrate },
    opts.proficiencyConcentration
  )

  const skill = winrateToRating(personalWinrate) - winrateToRating(globalWinrate)

  return skill + unfamiliarity
}
