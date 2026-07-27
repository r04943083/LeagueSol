/**
 * Win rates compose badly: you cannot add two 53% win rates and get anything meaningful. Ratings
 * do compose — they live on a log-odds scale where independent effects are additive, which is what
 * lets a draft score be a sum of a base term plus per-pair corrections.
 *
 * The scale is Elo's (400 points per factor-of-10 odds change) rather than raw logits, purely so
 * the intermediate numbers are readable and comparable to published draft analysis. It is a linear
 * rescale of the logit, so nothing about the model depends on the choice.
 */

/** Elo points per decade of odds. */
const ELO_SCALE = 400

/**
 * Win rates are clamped away from 0 and 1 before the log-odds transform, which would otherwise
 * diverge. A cell reporting a literal 0% or 100% is always a tiny sample, and shrinkage should
 * have pulled it off the boundary already — this is the last line of defence, not the mechanism.
 */
const WINRATE_EPSILON = 1e-6

export function clampWinrate(winrate: number): number {
  if (!Number.isFinite(winrate)) {
    throw new RangeError(`win rate must be finite, received ${winrate}`)
  }

  return Math.min(1 - WINRATE_EPSILON, Math.max(WINRATE_EPSILON, winrate))
}

/**
 * Win rate to rating, relative to an even matchup. A 50% win rate is 0; higher is positive.
 */
export function winrateToRating(winrate: number): number {
  const p = clampWinrate(winrate)

  return -ELO_SCALE * Math.log10(1 / p - 1)
}

/**
 * Inverse of {@link winrateToRating}: the logistic curve.
 */
export function ratingToWinrate(rating: number): number {
  if (!Number.isFinite(rating)) {
    throw new RangeError(`rating must be finite, received ${rating}`)
  }

  return 1 / (1 + Math.pow(10, -rating / ELO_SCALE))
}

/**
 * Sums ratings and converts back to a win rate. Present so callers never hand-roll the round trip
 * and accidentally average win rates instead.
 */
export function combineRatings(...ratings: number[]): number {
  return ratingToWinrate(ratings.reduce((sum, r) => sum + r, 0))
}
