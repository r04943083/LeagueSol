import { describe, expect, it, vi } from 'vitest'

import {
  counterTargetsFrom,
  fetchAllCounters,
  fetchChampionRates,
  fetchCounters,
  positionToRole,
  roleToPosition
} from './opgg-champion-source'

const SCOPE = { region: 'kr', tier: 'emerald_plus' } as const

/** Shaped after a real bulk response, trimmed to the fields this module reads. */
function bulkResponse() {
  return {
    data: {
      meta: { version: '16.14', cached_at: '2026-07-27 17:31:47', match_count: 4_290_413 },
      data: [
        {
          id: 86,
          positions: [{ name: 'TOP', stats: { play: 15_077, win_rate: 0.5083 }, counters: [] }]
        },
        {
          id: 103,
          positions: [
            { name: 'MID', stats: { play: 32_534, win_rate: 0.503811 }, counters: [] },
            { name: 'SUPPORT', stats: { play: 800, win_rate: 0.48 }, counters: [] }
          ]
        },
        // Positions op.gg does not classify, and champions with no play, must not reach the engine.
        { id: 999, positions: [{ name: 'UNKNOWN', stats: { play: 10, win_rate: 0.5 } }] },
        { id: 998, positions: [{ name: 'TOP', stats: { play: 0, win_rate: 0 } }] },
        { id: 997, positions: null }
      ]
    }
  }
}

describe('position mapping', () => {
  it('round-trips every role', () => {
    for (const [position, role] of [
      ['TOP', 'top'],
      ['JUNGLE', 'jungle'],
      ['MID', 'mid'],
      ['ADC', 'adc'],
      ['SUPPORT', 'support']
    ] as const) {
      expect(positionToRole(position)).toBe(role)
      expect(roleToPosition(role)).toBe(role)
    }
  })

  it('returns undefined for a position it does not recognise', () => {
    expect(positionToRole('NEXUS')).toBeUndefined()
  })
})

describe('fetchChampionRates', () => {
  it('reconstructs win counts from op.gg win rates', async () => {
    // op.gg publishes a rate; the engine needs counts to shrink. Getting this backwards would make
    // every sample size meaningless.
    const helper = { getChampions: vi.fn().mockResolvedValue(bulkResponse()) }

    const result = await fetchChampionRates(helper as never, SCOPE)

    const ahriMid = result.records.find((r) => r.championId === 103 && r.role === 'mid')!
    expect(ahriMid.games).toBe(32_534)
    expect(ahriMid.wins).toBe(Math.round(32_534 * 0.503811))
    expect(ahriMid.wins / ahriMid.games).toBeCloseTo(0.503811, 4)
  })

  it('reads the patch from the response rather than assuming it', async () => {
    const helper = { getChampions: vi.fn().mockResolvedValue(bulkResponse()) }

    const result = await fetchChampionRates(helper as never, SCOPE)

    expect(result.patch).toBe('16.14')
    expect(result.matchCount).toBe(4_290_413)
  })

  it('keeps every position a champion is played in', async () => {
    const helper = { getChampions: vi.fn().mockResolvedValue(bulkResponse()) }

    const result = await fetchChampionRates(helper as never, SCOPE)

    expect(result.records.filter((r) => r.championId === 103).map((r) => r.role).sort()).toEqual([
      'mid',
      'support'
    ])
  })

  it('drops unrecognised positions, zero-play entries and missing position lists', async () => {
    const helper = { getChampions: vi.fn().mockResolvedValue(bulkResponse()) }

    const result = await fetchChampionRates(helper as never, SCOPE)
    const ids = result.records.map((r) => r.championId)

    expect(ids).not.toContain(999)
    expect(ids).not.toContain(998)
    expect(ids).not.toContain(997)
    expect(ids).toContain(86)
  })

  it('passes the requested scope through', async () => {
    const helper = { getChampions: vi.fn().mockResolvedValue(bulkResponse()) }

    await fetchChampionRates(helper as never, SCOPE)

    expect(helper.getChampions).toHaveBeenCalledWith(
      'kr',
      'ranked',
      expect.objectContaining({ tier: 'emerald_plus' })
    )
  })
})

describe('fetchCounters', () => {
  it('maps counters to same-lane cross-team records', async () => {
    const helper = {
      getChampion: vi.fn().mockResolvedValue({
        data: {
          data: {
            counters: [
              { champion_id: 517, play: 2478, win: 1255 },
              { champion_id: 112, play: 1653, win: 803 }
            ]
          }
        }
      })
    }

    const records = await fetchCounters(helper as never, 103, 'mid', SCOPE)

    expect(records).toEqual([
      { championId: 103, role: 'mid', otherChampionId: 517, otherRole: 'mid', games: 2478, wins: 1255 },
      { championId: 103, role: 'mid', otherChampionId: 112, otherRole: 'mid', games: 1653, wins: 803 }
    ])
  })

  it('tolerates a champion with no counters', async () => {
    const helper = { getChampion: vi.fn().mockResolvedValue({ data: { data: {} } }) }

    expect(await fetchCounters(helper as never, 1, 'top', SCOPE)).toEqual([])
  })
})

describe('fetchAllCounters', () => {
  it('fetches every target and concatenates the results', async () => {
    const helper = {
      getChampion: vi.fn().mockImplementation((_r, _m, championId) =>
        Promise.resolve({
          data: { data: { counters: [{ champion_id: 500 + championId, play: 100, win: 50 }] } }
        })
      )
    }

    const targets = [
      { championId: 1, role: 'top' as const },
      { championId: 2, role: 'mid' as const },
      { championId: 3, role: 'adc' as const }
    ]

    const records = await fetchAllCounters(helper as never, targets, SCOPE, { concurrency: 2 })

    expect(records).toHaveLength(3)
    expect(records.map((r) => r.championId).sort()).toEqual([1, 2, 3])
  })

  it('skips a champion that fails rather than aborting the refresh', async () => {
    // One unavailable champion should degrade that champion's advice, not the whole patch refresh.
    const helper = {
      getChampion: vi.fn().mockImplementation((_r, _m, championId) =>
        championId === 2
          ? Promise.reject(new Error('502'))
          : Promise.resolve({ data: { data: { counters: [{ champion_id: 9, play: 10, win: 5 }] } } })
      )
    }
    const onError = vi.fn()

    const records = await fetchAllCounters(
      helper as never,
      [
        { championId: 1, role: 'top' },
        { championId: 2, role: 'mid' },
        { championId: 3, role: 'adc' }
      ],
      SCOPE,
      { onError }
    )

    expect(records).toHaveLength(2)
    expect(onError).toHaveBeenCalledTimes(1)
  })

  it('stops early when aborted', async () => {
    const controller = new AbortController()
    const helper = {
      getChampion: vi.fn().mockImplementation(() => {
        controller.abort()
        return Promise.resolve({ data: { data: { counters: [] } } })
      })
    }

    const targets = Array.from({ length: 50 }, (_, i) => ({ championId: i, role: 'top' as const }))
    await fetchAllCounters(helper as never, targets, SCOPE, {
      concurrency: 1,
      signal: controller.signal
    })

    expect(helper.getChampion.mock.calls.length).toBeLessThan(50)
  })

  it('reports progress', async () => {
    const helper = {
      getChampion: vi.fn().mockResolvedValue({ data: { data: { counters: [] } } })
    }
    const onProgress = vi.fn()

    await fetchAllCounters(
      helper as never,
      [
        { championId: 1, role: 'top' },
        { championId: 2, role: 'mid' }
      ],
      SCOPE,
      { concurrency: 1, onProgress }
    )

    expect(onProgress).toHaveBeenLastCalledWith(2, 2)
  })

  it('handles an empty target list', async () => {
    const helper = { getChampion: vi.fn() }
    expect(await fetchAllCounters(helper as never, [], SCOPE)).toEqual([])
    expect(helper.getChampion).not.toHaveBeenCalled()
  })
})

describe('counterTargetsFrom', () => {
  it('skips champion/role combinations nobody plays', async () => {
    // Counters cost one request each, so spending them on off-role noise is the main avoidable
    // cost in a patch refresh.
    const targets = counterTargetsFrom(
      [
        { championId: 1, role: 'top', games: 20_000, wins: 10_000 },
        { championId: 2, role: 'support', games: 40, wins: 20 }
      ],
      500
    )

    expect(targets).toEqual([{ championId: 1, role: 'top' }])
  })
})
