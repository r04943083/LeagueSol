import type { DraftModel } from './model'
import { ratingToWinrate } from './rating'
import type { DraftState, Recommendation, Role, ScoreContribution } from './types'

export interface ScoreOptions {
  /**
   * Weight on the matchup term when the opponent occupies the same role — the lane opponent you
   * actually trade with.
   */
  sameLaneMatchupWeight?: number
  /**
   * Weight for an opponent in a different role. A fed enemy jungler is everyone's problem, so this
   * is modelled — but note that **op.gg publishes no cross-lane matchup data at all**: a full patch
   * refresh yields 0 cross-lane cells out of ~11,000, every one being top/top, mid/mid and so on.
   * This weight therefore has no effect on op.gg-sourced statistics today, and exists for a data
   * source that does carry them (an own Match-V5 crawl would).
   */
  crossLaneMatchupWeight?: number
  /**
   * Scales every pair term. Pair statistics carry a counter-pick selection bias that nobody
   * publishes a correction for: a champion picked last into a known matchup shows an inflated win
   * rate that is not causally the matchup's doing. Damping below 1 acknowledges that the residuals
   * overstate what a pick actually buys.
   */
  pairWeight?: number
}

const DEFAULT_SCORE_OPTIONS: Required<ScoreOptions> = {
  sameLaneMatchupWeight: 1,
  crossLaneMatchupWeight: 0.4,
  pairWeight: 0.85
}

/**
 * Scores one candidate champion against a draft state.
 *
 * The total is a sum of independent rating terms, and every term is returned alongside it. That
 * decomposition is the point: "Kindred, +18" is not actionable, whereas "+11 base, +9 with your
 * Lulu, -7 into their Ahri, and the Lulu term rests on 240 games" is something a player can agree
 * or disagree with.
 */
export function scoreCandidate(
  model: DraftModel,
  state: DraftState,
  championId: number,
  options: ScoreOptions = {}
): Recommendation {
  const opts = { ...DEFAULT_SCORE_OPTIONS, ...options }
  const { role } = state

  const baseRating = model.championRating(championId, role)
  const contributions: ScoreContribution[] = [
    {
      kind: 'base',
      rating: baseRating,
      games: model.championGames(championId, role),
      evidence: 1
    }
  ]

  let total = baseRating

  for (const ally of state.allies) {
    const effect = model.synergy(championId, role, ally.championId, ally.role)
    if (effect.games === 0 && effect.rating === 0) {
      continue
    }

    const rating = effect.rating * opts.pairWeight
    total += rating
    contributions.push({
      kind: 'synergy',
      otherChampionId: ally.championId,
      otherRole: ally.role,
      rating,
      games: effect.games,
      evidence: effect.evidence
    })
  }

  for (const enemy of state.enemies) {
    const effect = model.matchup(championId, role, enemy.championId, enemy.role)
    if (effect.games === 0 && effect.rating === 0) {
      continue
    }

    const laneWeight =
      enemy.role === role ? opts.sameLaneMatchupWeight : opts.crossLaneMatchupWeight
    const rating = effect.rating * opts.pairWeight * laneWeight
    total += rating
    contributions.push({
      kind: 'matchup',
      otherChampionId: enemy.championId,
      otherRole: enemy.role,
      rating,
      games: effect.games,
      evidence: effect.evidence
    })
  }

  return {
    championId,
    role,
    rating: total,
    winrate: ratingToWinrate(total),
    contributions
  }
}

export interface AdviseOptions extends ScoreOptions {
  /**
   * Champions to rank. Defaults to every champion with data in the role, but the caller should
   * almost always pass the player's actual pool — see `candidates.ts`.
   */
  candidates?: readonly number[]
  /** How many recommendations to return. */
  limit?: number
}

/**
 * Ranks candidates for the open slot, best first.
 *
 * Champions already taken by either team are removed: they cannot be picked.
 */
export function advise(
  model: DraftModel,
  state: DraftState,
  options: AdviseOptions = {}
): Recommendation[] {
  const taken = new Set<number>([
    ...state.allies.map((p) => p.championId),
    ...state.enemies.map((p) => p.championId)
  ])

  const pool = options.candidates ?? model.championsInRole(state.role)
  const seen = new Set<number>()
  const results: Recommendation[] = []

  for (const championId of pool) {
    if (taken.has(championId) || seen.has(championId)) {
      continue
    }
    seen.add(championId)
    results.push(scoreCandidate(model, state, championId, options))
  }

  results.sort((a, b) => b.rating - a.rating)

  return options.limit === undefined ? results : results.slice(0, options.limit)
}

export function roleOf(state: DraftState): Role {
  return state.role
}
