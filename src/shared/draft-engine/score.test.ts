import { describe, expect, it } from 'vitest'

import { DraftModel } from './model'
import { ratingToWinrate, winrateToRating } from './rating'
import { advise, scoreCandidate } from './score'
import type { ChampionPairRecord, ChampionRoleRecord, DraftStats, Role } from './types'

const BIG = 500_000

function champion(championId: number, role: Role, winrate: number): ChampionRoleRecord {
  return { championId, role, games: BIG, wins: Math.round(BIG * winrate) }
}

function pair(
  championId: number,
  role: Role,
  otherChampionId: number,
  otherRole: Role,
  winrate: number
): ChampionPairRecord {
  return {
    championId,
    role,
    otherChampionId,
    otherRole,
    games: BIG,
    wins: Math.round(BIG * winrate)
  }
}

const EVEN = ratingToWinrate(0)

/**
 * Three supports, all identically average on their own, distinguished only by how they interact
 * with the drafted ADC (champion 10) and the enemy support (champion 20).
 */
function buildStats(): DraftStats {
  return {
    patch: '16.14',
    region: 'kr',
    tier: 'emerald_plus',
    champions: [
      champion(1, 'support', 0.5),
      champion(2, 'support', 0.5),
      champion(3, 'support', 0.5),
      champion(10, 'adc', 0.5),
      champion(20, 'support', 0.5),
      champion(30, 'mid', 0.5)
    ],
    synergies: [
      pair(1, 'support', 10, 'adc', EVEN + 0.04),
      pair(2, 'support', 10, 'adc', EVEN),
      pair(3, 'support', 10, 'adc', EVEN)
    ],
    matchups: [
      pair(1, 'support', 20, 'support', EVEN),
      pair(2, 'support', 20, 'support', EVEN),
      pair(3, 'support', 20, 'support', EVEN + 0.04),
      pair(2, 'support', 30, 'mid', EVEN + 0.04)
    ]
  }
}

const model = DraftModel.compile(buildStats())

describe('scoreCandidate', () => {
  it('decomposes the total into terms that add back up', () => {
    const result = scoreCandidate(model, {
      allies: [{ championId: 10, role: 'adc' }],
      enemies: [{ championId: 20, role: 'support' }],
      role: 'support'
    }, 1)

    const summed = result.contributions.reduce((s, c) => s + c.rating, 0)
    expect(summed).toBeCloseTo(result.rating, 10)
    expect(result.winrate).toBeCloseTo(ratingToWinrate(result.rating), 10)
  })

  it('labels each term with the champion it came from', () => {
    const result = scoreCandidate(model, {
      allies: [{ championId: 10, role: 'adc' }],
      enemies: [{ championId: 20, role: 'support' }],
      role: 'support'
    }, 1)

    expect(result.contributions.find((c) => c.kind === 'base')).toBeDefined()
    const synergy = result.contributions.find((c) => c.kind === 'synergy')
    expect(synergy?.otherChampionId).toBe(10)
    expect(synergy?.otherRole).toBe('adc')
    const matchup = result.contributions.find((c) => c.kind === 'matchup')
    expect(matchup?.otherChampionId).toBe(20)
  })

  it('omits terms for champions with no data rather than emitting zeros', () => {
    const result = scoreCandidate(model, {
      allies: [{ championId: 999, role: 'top' }],
      enemies: [],
      role: 'support'
    }, 1)

    expect(result.contributions).toHaveLength(1)
    expect(result.contributions[0].kind).toBe('base')
  })

  it('weights a same-lane opponent above a cross-lane one', () => {
    // Champion 2 counters the enemy mid. That should count for something, but less than countering
    // the champion it stands next to for the whole laning phase.
    const sameLane = scoreCandidate(model, {
      allies: [],
      enemies: [{ championId: 20, role: 'support' }],
      role: 'support'
    }, 3)

    const crossLane = scoreCandidate(model, {
      allies: [],
      enemies: [{ championId: 30, role: 'mid' }],
      role: 'support'
    }, 2)

    const sameLaneTerm = sameLane.contributions.find((c) => c.kind === 'matchup')!.rating
    const crossLaneTerm = crossLane.contributions.find((c) => c.kind === 'matchup')!.rating

    expect(sameLaneTerm).toBeGreaterThan(crossLaneTerm)
    expect(crossLaneTerm).toBeGreaterThan(0)
  })
})

describe('advise', () => {
  it('ranks the synergistic pick first when the ally is drafted', () => {
    const results = advise(model, {
      allies: [{ championId: 10, role: 'adc' }],
      enemies: [],
      role: 'support'
    })

    expect(results[0].championId).toBe(1)
  })

  it('ranks the counter-pick first when only the opponent is known', () => {
    const results = advise(model, {
      allies: [],
      enemies: [{ championId: 20, role: 'support' }],
      role: 'support'
    })

    expect(results[0].championId).toBe(3)
  })

  it('lets draft context override raw champion strength', () => {
    // The point of the whole exercise. Champion 2 is the better champion in a vacuum and tops an
    // empty board; champion 1 is weaker but actually works with the drafted ADC. Once the ADC is
    // locked, the pairing has to win — otherwise this is just a tier list with extra steps.
    const contextual = DraftModel.compile({
      patch: '16.14',
      region: 'kr',
      tier: 'emerald_plus',
      champions: [
        champion(1, 'support', 0.5),
        champion(2, 'support', 0.52),
        champion(10, 'adc', 0.5)
      ],
      synergies: [
        pair(1, 'support', 10, 'adc', ratingToWinrate(winrateToRating(0.5)) + 0.05),
        pair(2, 'support', 10, 'adc', ratingToWinrate(winrateToRating(0.52)))
      ],
      matchups: []
    })

    const early = advise(contextual, { allies: [], enemies: [], role: 'support' })
    const withAlly = advise(contextual, {
      allies: [{ championId: 10, role: 'adc' }],
      enemies: [],
      role: 'support'
    })

    expect(early[0].championId).toBe(2)
    expect(withAlly[0].championId).toBe(1)
  })

  it('never recommends a champion already taken by either team', () => {
    const results = advise(model, {
      allies: [{ championId: 1, role: 'support' }],
      enemies: [{ championId: 2, role: 'support' }],
      role: 'support'
    })

    const ids = results.map((r) => r.championId)
    expect(ids).not.toContain(1)
    expect(ids).not.toContain(2)
    expect(ids).toContain(3)
  })

  it('returns results sorted best first', () => {
    const results = advise(model, {
      allies: [{ championId: 10, role: 'adc' }],
      enemies: [{ championId: 20, role: 'support' }],
      role: 'support'
    })

    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].rating).toBeGreaterThanOrEqual(results[i].rating)
    }
  })

  it('honours an explicit candidate pool', () => {
    const results = advise(
      model,
      { allies: [{ championId: 10, role: 'adc' }], enemies: [], role: 'support' },
      { candidates: [2, 3] }
    )

    expect(results.map((r) => r.championId).sort()).toEqual([2, 3])
  })

  it('deduplicates a pool containing repeats', () => {
    const results = advise(
      model,
      { allies: [], enemies: [], role: 'support' },
      { candidates: [2, 2, 2, 3] }
    )

    expect(results).toHaveLength(2)
  })

  it('applies the limit', () => {
    const results = advise(model, { allies: [], enemies: [], role: 'support' }, { limit: 2 })
    expect(results).toHaveLength(2)
  })

  it('returns nothing for a role with no data instead of throwing', () => {
    expect(advise(model, { allies: [], enemies: [], role: 'jungle' })).toEqual([])
  })

  it('damps pair terms below their raw residual', () => {
    // Counter-pick selection bias inflates published pair win rates; the engine deliberately does
    // not take them at face value.
    const damped = scoreCandidate(
      model,
      { allies: [{ championId: 10, role: 'adc' }], enemies: [], role: 'support' },
      1
    )
    const undamped = scoreCandidate(
      model,
      { allies: [{ championId: 10, role: 'adc' }], enemies: [], role: 'support' },
      1,
      { pairWeight: 1 }
    )

    const dampedSynergy = damped.contributions.find((c) => c.kind === 'synergy')!.rating
    const undampedSynergy = undamped.contributions.find((c) => c.kind === 'synergy')!.rating

    expect(dampedSynergy).toBeLessThan(undampedSynergy)
    expect(dampedSynergy).toBeGreaterThan(0)
    expect(undampedSynergy).toBeCloseTo(winrateToRating(EVEN + 0.04), 0)
  })
})
