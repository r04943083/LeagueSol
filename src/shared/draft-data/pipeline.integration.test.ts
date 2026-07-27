import { DraftModel, advise } from '@shared/draft-engine'
import { OpggHttpApiAxiosHelper } from '@shared/http-api-axios-helper/opgg'
import axios from 'axios'
import { describe, expect, it } from 'vitest'

import { DraftStatsCache, MemoryCacheStorage } from './cache'
import { fetchChampionCatalog, fetchLatestPatch, toMcpChampionName } from './champion-static'
import { counterTargetsFrom, fetchAllCounters, fetchChampionRates } from './opgg-champion-source'
import { fetchSynergies } from './opgg-synergy-source'

/**
 * End-to-end check against the live services: real statistics in, a real recommendation out.
 *
 * Deliberately scoped to a handful of champions rather than a full patch refresh — the point is to
 * prove the pieces fit together and that the numbers survive the trip, not to hammer op.gg.
 *
 * A caveat this test makes visible, and which should not be mistaken for a quality result: on a
 * slice this thin the pair terms come out at a couple of rating points against base terms of ten or
 * more, so the ranking is dominated by raw champion strength. That is the concentration estimator
 * working as designed — a few dozen cells carry little evidence of real between-pair variation, so
 * it shrinks hard — but it does mean this test demonstrates only that the pipeline runs, not that
 * the recommendations beat a tier list. Establishing that needs a full patch refresh and the
 * backtest.
 */

const LIVE = process.env.LEAGUESOL_LIVE_TESTS !== '0'
const describeLive = LIVE ? describe : describe.skip

const SCOPE = { region: 'kr', tier: 'emerald_plus' } as const

describeLive('draft pipeline (live)', () => {
  it('turns live statistics into a decomposed recommendation', async () => {
    const helper = new OpggHttpApiAxiosHelper(axios.create({ timeout: 30_000 }))

    const rates = await fetchChampionRates(helper, SCOPE)
    expect(rates.patch).toMatch(/^\d+\.\d+$/)
    expect(rates.records.length).toBeGreaterThan(150)

    // Sanity on the aggregate: champion win rates cluster tightly around even. If this drifts, the
    // rate-to-count reconstruction has gone wrong somewhere upstream.
    const overall =
      rates.records.reduce((sum, r) => sum + r.wins, 0) /
      rates.records.reduce((sum, r) => sum + r.games, 0)
    expect(overall).toBeGreaterThan(0.44)
    expect(overall).toBeLessThan(0.56)

    const catalog = await fetchChampionCatalog(await fetchLatestPatch())

    // A realistic bot lane decision: our ADC is locked, the enemy support is known, pick a support.
    const supports = counterTargetsFrom(rates.records, 2000)
      .filter((t) => t.role === 'support')
      .slice(0, 6)
    expect(supports.length).toBeGreaterThan(2)

    const matchups = await fetchAllCounters(helper, supports, SCOPE, { concurrency: 3 })
    expect(matchups.length).toBeGreaterThan(0)

    const synergies = (
      await Promise.all(
        supports.map(async (target) => {
          const identity = catalog.byId.get(target.championId)
          if (!identity) return []
          return fetchSynergies({
            champion: toMcpChampionName(identity.key),
            championId: target.championId,
            role: 'support',
            partnerRole: 'adc'
          })
        })
      )
    ).flat()
    expect(synergies.length).toBeGreaterThan(0)

    const model = DraftModel.compile({
      patch: rates.patch,
      region: SCOPE.region,
      tier: SCOPE.tier,
      champions: rates.records,
      synergies,
      matchups
    })

    const allyAdc = synergies[0].otherChampionId
    const enemySupport = matchups.find((m) => !supports.some((s) => s.championId === m.otherChampionId))!
      .otherChampionId

    const results = advise(
      model,
      {
        allies: [{ championId: allyAdc, role: 'adc' }],
        enemies: [{ championId: enemySupport, role: 'support' }],
        role: 'support'
      },
      { candidates: supports.map((s) => s.championId) }
    )

    expect(results.length).toBeGreaterThan(0)

    for (const result of results) {
      // A draft term should never imply a lopsided game on its own; if it does, shrinkage failed.
      expect(result.winrate).toBeGreaterThan(0.3)
      expect(result.winrate).toBeLessThan(0.7)

      const summed = result.contributions.reduce((s, c) => s + c.rating, 0)
      expect(summed).toBeCloseTo(result.rating, 6)

      for (const contribution of result.contributions) {
        expect(contribution.evidence).toBeGreaterThanOrEqual(0)
        expect(contribution.evidence).toBeLessThanOrEqual(1)
        expect(contribution.games).toBeGreaterThanOrEqual(0)
      }
    }

    // Ranked, not arbitrary.
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].rating).toBeGreaterThanOrEqual(results[i].rating)
    }

    // Readable evidence of the real run, so a regression here is diagnosable rather than a bare
    // assertion failure.
    const name = (id: number) => catalog.byId.get(id)?.name ?? String(id)
    console.log(
      `\npatch ${rates.patch} ${SCOPE.region}/${SCOPE.tier} — support with ${name(allyAdc)}, into ${name(enemySupport)}:`
    )
    for (const result of results.slice(0, 5)) {
      const terms = result.contributions
        .map((c) =>
          c.kind === 'base'
            ? `base ${c.rating.toFixed(1)}`
            : `${c.kind === 'synergy' ? '+' : 'vs'}${name(c.otherChampionId!)} ${c.rating >= 0 ? '+' : ''}${c.rating.toFixed(1)} (${c.games}g)`
        )
        .join(', ')
      console.log(
        `  ${name(result.championId).padEnd(12)} ${(result.winrate * 100).toFixed(2)}%  [${terms}]`
      )
    }
  }, 180_000)

  it('serves a second assembly from cache without refetching', async () => {
    const cache = new DraftStatsCache(new MemoryCacheStorage())
    const key = { patch: '16.14', region: 'kr', tier: 'emerald_plus' }

    await cache.write('draft-stats', key, { champions: [], synergies: [], matchups: [] })
    expect(await cache.read('draft-stats', key)).toBeDefined()
    expect(await cache.read('draft-stats', { ...key, patch: '16.15' })).toBeUndefined()
  })
})
