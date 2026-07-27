import { describe, expect, it } from 'vitest'

import {
  ObservedCell,
  estimateConcentration,
  evidenceWeight,
  shrinkWinrate
} from './shrinkage'

/** Deterministic PRNG so the sampling-noise tests cannot flake. */
function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function sampleBinomial(n: number, p: number, rng: () => number): number {
  let wins = 0
  for (let i = 0; i < n; i++) {
    if (rng() < p) wins++
  }
  return wins
}

function variance(values: number[]): number {
  const mean = values.reduce((s, v) => s + v, 0) / values.length
  return values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length
}

describe('shrinkWinrate', () => {
  it('returns the prior when there are no games', () => {
    expect(shrinkWinrate({ games: 0, wins: 0, priorMean: 0.53 }, 100)).toBeCloseTo(0.53, 10)
  })

  it('barely moves a large sample', () => {
    const observed = shrinkWinrate({ games: 100_000, wins: 56_000, priorMean: 0.5 }, 200)
    expect(observed).toBeGreaterThan(0.559)
    expect(observed).toBeLessThan(0.56)
  })

  it('pulls a small sample most of the way back to the prior', () => {
    // 8 wins from 10 games is 80%, but on 10 games it is worth almost nothing.
    const shrunk = shrinkWinrate({ games: 10, wins: 8, priorMean: 0.5 }, 500)
    expect(shrunk).toBeLessThan(0.51)
    expect(shrunk).toBeGreaterThan(0.5)
  })

  it('shrinks toward the supplied prior, not toward one half', () => {
    // The whole point of a per-cell prior: a pair of strong champions with no pair data should
    // fall back to "both strong, no interaction", not to a coin flip.
    expect(shrinkWinrate({ games: 0, wins: 0, priorMean: 0.57 }, 300)).toBeCloseTo(0.57, 10)
  })

  it('is monotonic in the observation', () => {
    const low = shrinkWinrate({ games: 400, wins: 180, priorMean: 0.5 }, 300)
    const high = shrinkWinrate({ games: 400, wins: 220, priorMean: 0.5 }, 300)
    expect(low).toBeLessThan(high)
  })

  it('with zero concentration returns the raw observation', () => {
    expect(shrinkWinrate({ games: 10, wins: 8, priorMean: 0.5 }, 0)).toBeCloseTo(0.8, 10)
  })

  it('rejects a negative concentration', () => {
    expect(() => shrinkWinrate({ games: 10, wins: 5, priorMean: 0.5 }, -1)).toThrow(RangeError)
  })
})

describe('evidenceWeight', () => {
  it('runs from no evidence to nearly all evidence', () => {
    expect(evidenceWeight(0, 300)).toBe(0)
    expect(evidenceWeight(300, 300)).toBeCloseTo(0.5, 10)
    expect(evidenceWeight(30_000, 300)).toBeGreaterThan(0.99)
  })

  it('is zero when there is neither data nor prior', () => {
    expect(evidenceWeight(0, 0)).toBe(0)
  })
})

describe('estimateConcentration', () => {
  it('recovers a known spread when sampling noise is negligible', () => {
    // Cells with a real, known spread of true rates and enough games that binomial noise is tiny.
    // The estimator should back out roughly p(1-p)/tau^2 - 1.
    const games = 20_000
    const trueRates: number[] = []
    for (let i = 0; i < 200; i++) {
      trueRates.push(0.5 + (i / 199 - 0.5) * 0.08)
    }

    const cells: ObservedCell[] = trueRates.map((rate) => ({
      games,
      wins: Math.round(games * rate),
      priorMean: 0.5
    }))

    const tauSquared = variance(trueRates)
    const expected = 0.25 / tauSquared - 1

    const estimate = estimateConcentration(cells, { max: 1e9 })

    expect(estimate).toBeGreaterThan(expected * 0.9)
    expect(estimate).toBeLessThan(expected * 1.1)
  })

  it('shrinks maximally when the spread is pure sampling noise', () => {
    // Every cell has the same true rate, so all observed variation is noise. There is no real
    // interaction effect to preserve, and the estimator should say so rather than inventing one.
    const rng = mulberry32(42)
    const cells: ObservedCell[] = []
    for (let i = 0; i < 400; i++) {
      const games = 200
      cells.push({ games, wins: sampleBinomial(games, 0.5, rng), priorMean: 0.5 })
    }

    expect(estimateConcentration(cells, { max: 12_345 })).toBe(12_345)
  })

  it('separates real spread from noise', () => {
    // Same true spread as the noiseless case, but now observed through 300-game samples. The
    // estimate should still land near the truth rather than being dominated by binomial noise.
    const rng = mulberry32(7)
    const games = 300
    const trueRates: number[] = []
    for (let i = 0; i < 3000; i++) {
      trueRates.push(0.5 + (i / 2999 - 0.5) * 0.08)
    }

    const cells: ObservedCell[] = trueRates.map((rate) => ({
      games,
      wins: sampleBinomial(games, rate, rng),
      priorMean: 0.5
    }))

    const expected = 0.25 / variance(trueRates) - 1
    const estimate = estimateConcentration(cells, { max: 1e9 })

    expect(estimate).toBeGreaterThan(expected * 0.7)
    expect(estimate).toBeLessThan(expected * 1.4)
  })

  it('falls back to maximal shrinkage without enough usable cells', () => {
    expect(estimateConcentration([], { max: 999 })).toBe(999)
    expect(
      estimateConcentration([{ games: 1000, wins: 500, priorMean: 0.5 }], { max: 999 })
    ).toBe(999)
  })

  it('ignores cells below the minimum sample size', () => {
    // A pile of 1-game cells is all noise; without the floor they would dominate the estimate.
    const noise: ObservedCell[] = []
    for (let i = 0; i < 500; i++) {
      noise.push({ games: 1, wins: i % 2, priorMean: 0.5 })
    }

    expect(estimateConcentration(noise, { minGamesForEstimate: 30, max: 4321 })).toBe(4321)
  })

  it('respects the bounds', () => {
    const rng = mulberry32(11)
    const cells: ObservedCell[] = []
    for (let i = 0; i < 300; i++) {
      cells.push({ games: 500, wins: sampleBinomial(500, 0.5 + (i % 7) * 0.02, rng), priorMean: 0.5 })
    }

    expect(estimateConcentration(cells, { min: 5000, max: 1e9 })).toBeGreaterThanOrEqual(5000)
    expect(estimateConcentration(cells, { min: 0, max: 3 })).toBeLessThanOrEqual(3)
  })
})
