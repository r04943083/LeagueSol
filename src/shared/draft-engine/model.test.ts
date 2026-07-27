import { describe, expect, it } from 'vitest'

import { DraftModel } from './model'
import { ratingToWinrate, winrateToRating } from './rating'
import type { ChampionPairRecord, ChampionRoleRecord, DraftStats, Role } from './types'

const BIG = 200_000

function champion(
  championId: number,
  role: Role,
  winrate: number,
  games = BIG
): ChampionRoleRecord {
  return { championId, role, games, wins: Math.round(games * winrate) }
}

function pair(
  championId: number,
  role: Role,
  otherChampionId: number,
  otherRole: Role,
  winrate: number,
  games = BIG
): ChampionPairRecord {
  return {
    championId,
    role,
    otherChampionId,
    otherRole,
    games,
    wins: Math.round(games * winrate)
  }
}

/**
 * Champion 1: a strong ADC. Champions 2 and 3: average supports, one of which genuinely enables
 * champion 1 while the other merely stands next to it.
 */
function buildStats(overrides: Partial<DraftStats> = {}): DraftStats {
  const strongAdc = 0.55
  const averageSupport = 0.5
  const noInteractionDuo = ratingToWinrate(
    winrateToRating(strongAdc) + winrateToRating(averageSupport)
  )

  return {
    patch: '16.14',
    region: 'kr',
    tier: 'emerald_plus',
    champions: [
      champion(1, 'adc', strongAdc),
      champion(2, 'support', averageSupport),
      champion(3, 'support', averageSupport),
      champion(4, 'adc', 0.5),
      champion(5, 'mid', 0.5)
    ],
    synergies: [
      // Champion 2 adds nothing beyond champion 1's own strength.
      pair(1, 'adc', 2, 'support', noInteractionDuo),
      // Champion 3 does: three points of win rate above the no-interaction baseline.
      pair(1, 'adc', 3, 'support', noInteractionDuo + 0.03)
    ],
    matchups: [
      // An even matchup between two average champions.
      pair(4, 'adc', 1, 'adc', ratingToWinrate(winrateToRating(0.5) - winrateToRating(strongAdc))),
      // Champion 5 punches above its weight into champion 1.
      pair(5, 'mid', 1, 'adc', 0.55)
    ],
    ...overrides
  }
}

describe('DraftModel', () => {
  it('does not mistake a strong champion for a synergistic one', () => {
    // The headline failure mode of naive pair statistics. Champions 1+2 post a raw win rate well
    // above 50% purely because champion 1 is strong; that must resolve to zero synergy, or every
    // strong champion looks like it pairs well with the entire roster.
    const model = DraftModel.compile(buildStats())

    const inert = model.synergy(1, 'adc', 2, 'support')
    const real = model.synergy(1, 'adc', 3, 'support')

    expect(Math.abs(inert.rating)).toBeLessThan(1)
    expect(real.rating).toBeGreaterThan(15)
  })

  it('does not mistake a strong opponent for a good matchup', () => {
    const model = DraftModel.compile(buildStats())

    const expected = model.matchup(4, 'adc', 1, 'adc')
    const genuine = model.matchup(5, 'mid', 1, 'adc')

    expect(Math.abs(expected.rating)).toBeLessThan(1)
    expect(genuine.rating).toBeGreaterThan(15)
  })

  it('recovers champion ratings from win rates', () => {
    const model = DraftModel.compile(buildStats())

    expect(model.championRating(1, 'adc')).toBeCloseTo(winrateToRating(0.55), 0)
    expect(model.championRating(2, 'support')).toBeCloseTo(0, 0)
  })

  it('treats unknown champions and pairs as neutral rather than throwing', () => {
    // Matters in practice: on servers where op.gg has no coverage the tables are full of holes,
    // and a missing cell must cost a pick nothing rather than crash the draft panel.
    const model = DraftModel.compile(buildStats())

    expect(model.championRating(999, 'top')).toBe(0)
    expect(model.championGames(999, 'top')).toBe(0)
    expect(model.hasChampion(999, 'top')).toBe(false)
    expect(model.synergy(999, 'top', 1, 'adc')).toEqual({ rating: 0, games: 0, evidence: 0 })
    expect(model.matchup(999, 'top', 1, 'adc')).toEqual({ rating: 0, games: 0, evidence: 0 })
  })

  it('reports evidence proportional to sample size', () => {
    const stats = buildStats({
      synergies: [pair(1, 'adc', 2, 'support', 0.6, 40), pair(1, 'adc', 3, 'support', 0.6, 400_000)]
    })
    const model = DraftModel.compile(stats)

    expect(model.synergy(1, 'adc', 2, 'support').evidence).toBeLessThan(
      model.synergy(1, 'adc', 3, 'support').evidence
    )
    expect(model.synergy(1, 'adc', 2, 'support').games).toBe(40)
  })

  it('damps a low-sample pair far more than a high-sample one', () => {
    // Same eye-catching 60% win rate, wildly different sample sizes. The 40-game cell must not
    // move a recommendation nearly as much as the 400,000-game one.
    const stats = buildStats({
      synergies: [
        pair(1, 'adc', 2, 'support', 0.62, 40),
        pair(1, 'adc', 3, 'support', 0.62, 400_000)
      ]
    })
    const model = DraftModel.compile(stats)

    const small = Math.abs(model.synergy(1, 'adc', 2, 'support').rating)
    const large = Math.abs(model.synergy(1, 'adc', 3, 'support').rating)

    expect(small).toBeLessThan(large / 2)
  })

  it('carries patch, region and tier through so results are never silently cross-patch', () => {
    const model = DraftModel.compile(buildStats())

    expect(model.patch).toBe('16.14')
    expect(model.region).toBe('kr')
    expect(model.tier).toBe('emerald_plus')
  })

  it('lists champions by role', () => {
    const model = DraftModel.compile(buildStats())

    expect([...model.championsInRole('support')].sort()).toEqual([2, 3])
    expect([...model.championsInRole('adc')].sort()).toEqual([1, 4])
    expect(model.championsInRole('top')).toEqual([])
  })

  it('compiles empty stats without throwing', () => {
    const model = DraftModel.compile({
      patch: '16.14',
      region: 'kr',
      tier: 'all',
      champions: [],
      synergies: [],
      matchups: []
    })

    expect(model.championRating(1, 'adc')).toBe(0)
  })
})
