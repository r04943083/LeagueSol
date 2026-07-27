import { winrateToRating } from './rating'

/**
 * The single easiest thing to get wrong in a draft model is to read a pair's raw win rate as if it
 * were an interaction effect.
 *
 * "Lulu + Jinx win 52%" mostly says Jinx is strong this patch. It says almost nothing about whether
 * the two work well *together*, which is the only part that should influence a pick — Jinx's own
 * strength is already counted in the base term, and counting it again double-weights whichever
 * champion happens to be strong.
 *
 * What matters is the residual: how much the pair over- or under-performs the *baseline* it would
 * reach with no interaction at all. Because ratings are additive, that baseline is elementary
 * arithmetic on the two champions' individual ratings.
 */

/**
 * Expected rating for two allies who do nothing for each other: their strengths simply add.
 */
export function synergyBaseline(championRating: number, allyRating: number): number {
  return championRating + allyRating
}

/**
 * Expected rating for a champion facing an opponent, with no matchup effect either way. The
 * opponent's strength *subtracts*: a strong enemy drags the expected win rate down by exactly their
 * own rating.
 */
export function matchupBaseline(championRating: number, enemyRating: number): number {
  return championRating - enemyRating
}

/**
 * How much a pair over-performs its no-interaction baseline, in rating points.
 *
 * Positive synergy means two allies genuinely enable each other. Positive matchup means this
 * champion does better into that opponent than raw strength explains — a real counter, rather than
 * merely a good champion.
 */
export function residual(pairWinrate: number, baselineRating: number): number {
  return winrateToRating(pairWinrate) - baselineRating
}
