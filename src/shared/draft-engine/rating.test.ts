import { describe, expect, it } from 'vitest'

import { clampWinrate, combineRatings, ratingToWinrate, winrateToRating } from './rating'

describe('rating transforms', () => {
  it('maps an even matchup to zero', () => {
    expect(winrateToRating(0.5)).toBeCloseTo(0, 10)
    expect(ratingToWinrate(0)).toBeCloseTo(0.5, 10)
  })

  it('is monotonic in win rate', () => {
    expect(winrateToRating(0.45)).toBeLessThan(winrateToRating(0.5))
    expect(winrateToRating(0.5)).toBeLessThan(winrateToRating(0.55))
  })

  it('round-trips', () => {
    for (const winrate of [0.05, 0.3, 0.5, 0.512, 0.7, 0.95]) {
      expect(ratingToWinrate(winrateToRating(winrate))).toBeCloseTo(winrate, 10)
    }
  })

  it('puts 400 points at ten-to-one odds, matching the Elo convention', () => {
    expect(winrateToRating(10 / 11)).toBeCloseTo(400, 6)
  })

  it('is antisymmetric about even odds', () => {
    expect(winrateToRating(0.6)).toBeCloseTo(-winrateToRating(0.4), 10)
  })

  it('adds ratings rather than averaging win rates', () => {
    // Two independent +50 edges compound; they do not average back to 50%.
    const combined = combineRatings(50, 50)
    expect(combined).toBeCloseTo(ratingToWinrate(100), 10)
    expect(combined).toBeGreaterThan(ratingToWinrate(50))
  })

  it('clamps degenerate win rates instead of diverging', () => {
    expect(Number.isFinite(winrateToRating(0))).toBe(true)
    expect(Number.isFinite(winrateToRating(1))).toBe(true)
    expect(clampWinrate(0)).toBeGreaterThan(0)
    expect(clampWinrate(1)).toBeLessThan(1)
    expect(clampWinrate(0.5)).toBe(0.5)
  })

  it('rejects values that are not numbers', () => {
    expect(() => winrateToRating(Number.NaN)).toThrow(RangeError)
    expect(() => ratingToWinrate(Number.POSITIVE_INFINITY)).toThrow(RangeError)
  })
})
