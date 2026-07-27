import { describe, expect, it } from 'vitest'

import { buildCandidatePool, proficiencyAdjustment } from './candidates'
import { DraftModel } from './model'
import type { DraftStats } from './types'

const stats: DraftStats = {
  patch: '16.14',
  region: 'kr',
  tier: 'emerald_plus',
  champions: [
    { championId: 1, role: 'jungle', games: 500_000, wins: 250_000 },
    { championId: 2, role: 'jungle', games: 500_000, wins: 275_000 }
  ],
  synergies: [],
  matchups: []
}

const model = DraftModel.compile(stats)

describe('buildCandidatePool', () => {
  it('excludes champions the player does not own', () => {
    const pool = buildCandidatePool([
      { championId: 1, owned: true, games: 50 },
      { championId: 2, owned: false, games: 900 }
    ])

    expect(pool).toEqual([1])
  })

  it('applies a minimum game threshold when asked', () => {
    const proficiencies = [
      { championId: 1, owned: true, games: 3 },
      { championId: 2, owned: true, games: 80 }
    ]

    expect(buildCandidatePool(proficiencies, { minGames: 10 })).toEqual([2])
    expect(buildCandidatePool(proficiencies)).toEqual([1, 2])
  })
})

describe('proficiencyAdjustment', () => {
  it('penalises a champion the player has never touched', () => {
    const adjustment = proficiencyAdjustment(
      model,
      { championId: 2, owned: true, games: 0 },
      'jungle'
    )

    expect(adjustment).toBeCloseTo(-60, 5)
  })

  it('stops penalising once the champion is well practised', () => {
    const adjustment = proficiencyAdjustment(
      model,
      { championId: 2, owned: true, games: 300, wins: 165 },
      'jungle'
    )

    // 300 games at the champion's own global rate: no execution risk, no skill edge.
    expect(Math.abs(adjustment)).toBeLessThan(3)
  })

  it('rewards outperforming the champion global rate', () => {
    const better = proficiencyAdjustment(
      model,
      { championId: 1, owned: true, games: 200, wins: 130 },
      'jungle'
    )
    const worse = proficiencyAdjustment(
      model,
      { championId: 1, owned: true, games: 200, wins: 70 },
      'jungle'
    )

    expect(better).toBeGreaterThan(0)
    expect(worse).toBeLessThan(0)
  })

  it('shrinks a tiny personal sample toward the global rate', () => {
    // Four wins from four games is not a 100% win rate, and must not be scored as one.
    const hotStreak = proficiencyAdjustment(
      model,
      { championId: 1, owned: true, games: 4, wins: 4 },
      'jungle'
    )
    const sustained = proficiencyAdjustment(
      model,
      { championId: 1, owned: true, games: 400, wins: 260 },
      'jungle'
    )

    expect(hotStreak).toBeLessThan(sustained)
  })

  it('treats a champion with no recorded wins as merely unproven', () => {
    const unknown = proficiencyAdjustment(
      model,
      { championId: 1, owned: true, games: 40 },
      'jungle'
    )

    expect(unknown).toBeLessThan(0)
    expect(unknown).toBeGreaterThan(-60)
  })

  it('is a large enough effect to reorder a recommendation', () => {
    // Champion 2 is the stronger champion by 25 rating points, but on a champion the player has
    // never played the unfamiliarity penalty should be the bigger term.
    const strongerButUnplayed =
      model.championRating(2, 'jungle') +
      proficiencyAdjustment(model, { championId: 2, owned: true, games: 0 }, 'jungle')
    const weakerButPractised =
      model.championRating(1, 'jungle') +
      proficiencyAdjustment(model, { championId: 1, owned: true, games: 300, wins: 150 }, 'jungle')

    expect(weakerButPractised).toBeGreaterThan(strongerButUnplayed)
  })
})
