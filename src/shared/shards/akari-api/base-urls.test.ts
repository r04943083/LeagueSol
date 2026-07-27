import { describe, expect, it } from 'vitest'

import { parseAkariApiBootstrapDocument, resolveAkariStaticUrl } from './base-urls'
import {
  DEFAULT_AKARI_API_BASE_URL,
  DEFAULT_AKARI_SERVICE_BASE_URLS,
  DEFAULT_AKARI_STATIC_BASE_URL
} from './types'

describe('Akari API service discovery', () => {
  it('does not point at the upstream service', () => {
    expect(DEFAULT_AKARI_SERVICE_BASE_URLS).toEqual({
      api: DEFAULT_AKARI_API_BASE_URL,
      static: DEFAULT_AKARI_STATIC_BASE_URL
    })
    expect(DEFAULT_AKARI_API_BASE_URL).toBe('https://api.leaguesol.invalid')
    expect(DEFAULT_AKARI_STATIC_BASE_URL).toBe('https://static.leaguesol.invalid')
  })

  it('parses a valid bootstrap document', () => {
    expect(
      parseAkariApiBootstrapDocument({
        schemaVersion: 1,
        generation: 2,
        baseUrls: {
          api: 'https://api.leaguesol.invalid',
          static: 'https://static.leaguesol.invalid'
        }
      })
    ).toEqual({
      schemaVersion: 1,
      generation: 2,
      baseUrls: {
        api: 'https://api.leaguesol.invalid',
        static: 'https://static.leaguesol.invalid'
      }
    })
  })

  it('rejects an invalid bootstrap document', () => {
    expect(() => parseAkariApiBootstrapDocument({ schemaVersion: 2 })).toThrow()
  })

  it('resolves and encodes static object names', () => {
    expect(resolveAkariStaticUrl(DEFAULT_AKARI_STATIC_BASE_URL, 'LeagueSol-1.5.0-win.7z')).toBe(
      'https://static.leaguesol.invalid/LeagueSol-1.5.0-win.7z'
    )
  })

  it('allows an authoritative absolute static URL', () => {
    expect(
      resolveAkariStaticUrl(DEFAULT_AKARI_STATIC_BASE_URL, 'https://cdn.example.com/file.7z')
    ).toBe('https://cdn.example.com/file.7z')
  })
})
