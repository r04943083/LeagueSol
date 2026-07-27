import { describe, expect, it } from 'vitest'

import {
  LCU_FIXTURE_SCHEMA_VERSION,
  LcuFixture,
  eventsUpTo,
  indexResponses,
  responseKey,
  validateFixture
} from './lcu-fixture'

const fixture: LcuFixture = {
  schemaVersion: LCU_FIXTURE_SCHEMA_VERSION,
  recordedAt: '2026-07-27T00:00:00.000Z',
  description: 'test',
  durationMs: 5000,
  responses: [
    { method: 'GET', path: '/lol-champ-select/v1/session', status: 404, body: null },
    { method: 'GET', path: '/lol-champ-select/v1/session', status: 200, body: { myTeam: [] } },
    { method: 'GET', path: '/lol-summoner/v1/current-summoner', status: 200, body: { puuid: 'p' } }
  ],
  events: [
    { offsetMs: 0, uri: '/lol-champ-select/v1/session', eventType: 'Create', data: { a: 1 } },
    { offsetMs: 1200, uri: '/lol-champ-select/v1/session', eventType: 'Update', data: { a: 2 } },
    { offsetMs: 4800, uri: '/lol-champ-select/v1/session', eventType: 'Delete', data: null }
  ]
}

describe('responseKey', () => {
  it('normalises the method and drops the query string', () => {
    expect(responseKey('get', '/a/b?x=1')).toBe('GET /a/b')
  })
})

describe('indexResponses', () => {
  it('keeps the last recording of an endpoint', () => {
    // A recording starts before champion select, so the first capture of the session endpoint is a
    // 404. Replaying that instead of the real session would make every fixture look empty.
    const index = indexResponses(fixture)

    expect(index.get('GET /lol-champ-select/v1/session')?.status).toBe(200)
  })

  it('indexes every distinct endpoint', () => {
    expect(indexResponses(fixture).size).toBe(2)
  })
})

describe('eventsUpTo', () => {
  it('returns only events already due', () => {
    // Replay is time-driven because champion select is a sequence: the advisor must change its
    // answer as picks land, which a single burst would never exercise.
    expect(eventsUpTo(fixture, 0)).toHaveLength(1)
    expect(eventsUpTo(fixture, 1200)).toHaveLength(2)
    expect(eventsUpTo(fixture, 10_000)).toHaveLength(3)
  })

  it('preserves order', () => {
    expect(eventsUpTo(fixture, 5000).map((e) => e.eventType)).toEqual([
      'Create',
      'Update',
      'Delete'
    ])
  })
})

describe('validateFixture', () => {
  it('accepts a well-formed fixture', () => {
    expect(validateFixture(fixture).description).toBe('test')
  })

  it('rejects an unknown schema version', () => {
    expect(() => validateFixture({ ...fixture, schemaVersion: 99 })).toThrow(/unsupported/)
  })

  it('rejects a fixture missing its arrays', () => {
    expect(() => validateFixture({ ...fixture, events: undefined })).toThrow(/missing/)
    expect(() => validateFixture(null)).toThrow()
  })
})
