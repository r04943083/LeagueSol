/**
 * With ~170 champions there are on the order of 14k ordered champion pairs per role pairing. A
 * matchup cell needs roughly 2,400 games to pin its win rate to +/-2%, and almost none of them
 * have that. Reading raw pair win rates therefore does not produce a weak recommender, it produces
 * a noise generator: the pairs that look most extreme are simply the ones with the fewest games.
 *
 * The fix is a beta-binomial posterior — pull each cell toward a prior, hard when the sample is
 * small and barely at all when it is large:
 *
 *   posterior = (wins + concentration * priorMean) / (games + concentration)
 *
 * `concentration` is the prior's weight in units of games. Published tools tend to expose it as a
 * hand-tuned slider; it is estimable instead, because the spread of the observed cells tells us
 * how much real variation exists between them versus how much is sampling noise.
 */

export interface ObservedCell {
  games: number
  wins: number
  /**
   * The win rate this cell would be expected to show if there were no interaction effect — for a
   * duo, the two champions' individual strengths combined. Shrinking toward this rather than
   * toward a flat 50% means a low-sample pair falls back to "these two champions, no interaction"
   * instead of "we know nothing".
   */
  priorMean: number
}

export interface ConcentrationOptions {
  /**
   * Cells below this many games are excluded when estimating the concentration. They carry almost
   * no information about between-cell spread while contributing most of the noise.
   */
  minGamesForEstimate?: number
  /** Lower bound on the estimate, in games. */
  min?: number
  /** Upper bound on the estimate, in games. */
  max?: number
}

const DEFAULT_CONCENTRATION_OPTIONS: Required<ConcentrationOptions> = {
  minGamesForEstimate: 30,
  min: 20,
  max: 20_000
}

/**
 * Estimates the prior concentration by method of moments.
 *
 * For each cell the observed deviation from its prior decomposes into real between-cell variation
 * plus binomial sampling noise:
 *
 *   E[(p_hat - p0)^2] = tau^2 + p0 * (1 - p0) / n
 *
 * Averaging that identity over cells and solving for tau^2 gives the real spread; matching it to a
 * beta prior's variance, tau^2 = p0 * (1 - p0) / (concentration + 1), gives the concentration.
 *
 * When the observed spread is fully explained by sampling noise, tau^2 comes out at or below zero:
 * there is no evidence of any real interaction effect, and the correct response is maximal
 * shrinkage rather than an error.
 */
export function estimateConcentration(
  cells: readonly ObservedCell[],
  options: ConcentrationOptions = {}
): number {
  const { minGamesForEstimate, min, max } = { ...DEFAULT_CONCENTRATION_OPTIONS, ...options }

  const usable = cells.filter((c) => c.games >= minGamesForEstimate && c.games > 0)

  // Nothing to learn from; shrink as hard as the bounds allow.
  if (usable.length < 2) {
    return max
  }

  let excessVariance = 0
  let priorVariance = 0

  for (const cell of usable) {
    const observed = cell.wins / cell.games
    const p0 = cell.priorMean
    const binomialVariance = (p0 * (1 - p0)) / cell.games

    excessVariance += (observed - p0) ** 2 - binomialVariance
    priorVariance += p0 * (1 - p0)
  }

  const tauSquared = excessVariance / usable.length
  const meanPriorVariance = priorVariance / usable.length

  if (tauSquared <= 0) {
    return max
  }

  const concentration = meanPriorVariance / tauSquared - 1

  if (!Number.isFinite(concentration)) {
    return max
  }

  return Math.min(max, Math.max(min, concentration))
}

/**
 * Beta-binomial posterior mean for one cell.
 */
export function shrinkWinrate(cell: ObservedCell, concentration: number): number {
  if (concentration < 0) {
    throw new RangeError(`concentration must be non-negative, received ${concentration}`)
  }

  const denominator = cell.games + concentration

  // No games and no prior weight: the prior mean is the only information available.
  if (denominator === 0) {
    return cell.priorMean
  }

  return (cell.wins + concentration * cell.priorMean) / denominator
}

/**
 * How much of the posterior comes from the observation rather than the prior, in [0, 1]. Surfaced
 * in recommendation breakdowns so a suggestion driven by 40 games is visibly distinguishable from
 * one driven by 40,000.
 */
export function evidenceWeight(games: number, concentration: number): number {
  const denominator = games + concentration

  return denominator === 0 ? 0 : games / denominator
}
