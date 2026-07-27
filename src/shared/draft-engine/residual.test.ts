import { describe, expect, it } from 'vitest'

import { ratingToWinrate, winrateToRating } from './rating'
import { matchupBaseline, residual, synergyBaseline } from './residual'

describe('baselines', () => {
  it('adds ally ratings', () => {
    expect(synergyBaseline(30, 20)).toBe(50)
  })

  it('subtracts enemy ratings', () => {
    expect(matchupBaseline(30, 20)).toBe(10)
  })

  it('makes two average allies an even proposition', () => {
    expect(ratingToWinrate(synergyBaseline(0, 0))).toBeCloseTo(0.5, 10)
  })

  it('makes equally strong opponents an even proposition', () => {
    // Both champions strong in absolute terms, but neither has an edge over the other.
    expect(ratingToWinrate(matchupBaseline(40, 40))).toBeCloseTo(0.5, 10)
  })
})

describe('residual', () => {
  it('is zero when a pair performs exactly as its parts predict', () => {
    const baseline = synergyBaseline(winrateToRating(0.55), winrateToRating(0.5))
    expect(residual(ratingToWinrate(baseline), baseline)).toBeCloseTo(0, 8)
  })

  it('is positive only for genuine over-performance', () => {
    const baseline = synergyBaseline(winrateToRating(0.55), 0)
    const asExpected = ratingToWinrate(baseline)

    expect(residual(asExpected + 0.03, baseline)).toBeGreaterThan(0)
    expect(residual(asExpected - 0.03, baseline)).toBeLessThan(0)
  })

  it('does not credit a strong champion with synergy it has not earned', () => {
    // A 56% duo win rate sounds like synergy until you notice one champion wins 56% by itself and
    // the other is perfectly average. That pairing is worth exactly nothing, and the residual says
    // so — where reading the raw 56% would have ranked it well above a coin flip.
    const baseline = synergyBaseline(winrateToRating(0.56), 0)

    expect(residual(0.56, baseline)).toBeCloseTo(0, 8)
  })

  it('penalises two strong champions that merely coexist', () => {
    // Both champions are individually strong, so together they should be doing better than 56%.
    // Landing only at 56% is an anti-synergy, and must score negative.
    const baseline = synergyBaseline(winrateToRating(0.56), winrateToRating(0.53))

    expect(residual(0.56, baseline)).toBeLessThan(0)
  })
})
