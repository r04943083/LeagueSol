import { describe, expect, it } from 'vitest'

import { fetchChampionCatalog, fetchLatestPatch, toMcpChampionName } from './champion-static'
import { SYNERGY_ROLE_PAIRS, fetchSynergies, parseMcpEnvelope } from './opgg-synergy-source'

/**
 * These tests hit the live op.gg and Data Dragon endpoints.
 *
 * They exist because the failure mode that matters here is not a logic bug — it is an upstream
 * schema or availability change, which no amount of mocking will catch. They are separated from
 * the unit suite so a network outage never blocks ordinary development.
 */

const LIVE = process.env.LEAGUESOL_LIVE_TESTS !== '0'
const describeLive = LIVE ? describe : describe.skip

describeLive('op.gg synergy source (live)', () => {
  it('still returns ranked duo statistics with sample sizes', async () => {
    const patch = await fetchLatestPatch()
    const catalog = await fetchChampionCatalog(patch)
    const lulu = catalog.byKey.get('Lulu')

    expect(lulu).toBeDefined()

    const records = await fetchSynergies({
      champion: toMcpChampionName(lulu!.key),
      championId: lulu!.championId,
      role: 'support',
      partnerRole: 'adc'
    })

    expect(records.length).toBeGreaterThan(0)

    for (const record of records) {
      expect(record.championId).toBe(lulu!.championId)
      expect(record.role).toBe('support')
      expect(record.otherRole).toBe('adc')
      expect(record.games).toBeGreaterThan(0)
      // The single assertion that would catch a positional-argument transposition upstream.
      expect(record.wins).toBeLessThanOrEqual(record.games)
      expect(catalog.byId.has(record.otherChampionId)).toBe(true)
    }
  }, 60_000)

  it('covers every role pairing the engine asks about', async () => {
    // If op.gg drops support for a pairing, synergy silently becomes zero for it. Better to fail
    // loudly here than to ship a recommender that has quietly stopped modelling jungle/mid.
    const patch = await fetchLatestPatch()
    const catalog = await fetchChampionCatalog(patch)
    const jarvan = catalog.byKey.get('JarvanIV')!

    for (const [role, partnerRole] of SYNERGY_ROLE_PAIRS.filter(([r]) => r === 'jungle')) {
      const records = await fetchSynergies({
        champion: toMcpChampionName(jarvan.key),
        championId: jarvan.championId,
        role,
        partnerRole
      })

      expect(records.length, `${role} x ${partnerRole} returned nothing`).toBeGreaterThan(0)
    }
  }, 120_000)

  it('resolves every champion name the MCP endpoint needs', async () => {
    // Data Dragon keys are not uniformly camel-cased, so the conversion has hand-written
    // exceptions. A new champion with an awkward key would break silently; this catches it.
    const patch = await fetchLatestPatch()
    const catalog = await fetchChampionCatalog(patch)

    for (const identity of catalog.byId.values()) {
      const converted = toMcpChampionName(identity.key)
      expect(converted, `${identity.key} converted badly`).toMatch(/^[A-Z][A-Z0-9_]*$/)
    }
  }, 60_000)
})

describe('parseMcpEnvelope', () => {
  it('accepts a plain JSON body', () => {
    expect(parseMcpEnvelope('{"jsonrpc":"2.0","id":1,"result":{"content":[]}}')).toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: { content: [] }
    })
  })

  it('accepts a server-sent-events body', () => {
    const body = 'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"content":[]}}\n\n'
    expect(parseMcpEnvelope(body).result).toEqual({ content: [] })
  })

  it('rejects anything else rather than returning an empty result', () => {
    expect(() => parseMcpEnvelope('not a response')).toThrow()
  })
})
