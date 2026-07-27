import { describe, expect, it } from 'vitest'

import { LCU_ENDPOINT_ENV, resolveLcuEndpoint } from './endpoint'

describe('resolveLcuEndpoint', () => {
  it('points at the real client by default', () => {
    const endpoint = resolveLcuEndpoint(51234, 'tok', {})

    expect(endpoint.baseUrl).toBe('https://127.0.0.1:51234')
    expect(endpoint.webSocketUrl).toBe('wss://riot:tok@127.0.0.1:51234')
    expect(endpoint.isReplay).toBe(false)
  })

  it('redirects to a replay server when overridden', () => {
    const endpoint = resolveLcuEndpoint(51234, 'tok', {
      [LCU_ENDPOINT_ENV]: 'http://127.0.0.1:8777'
    })

    expect(endpoint.baseUrl).toBe('http://127.0.0.1:8777')
    // Scheme must follow the override: a replay server over plain HTTP cannot serve wss.
    expect(endpoint.webSocketUrl).toBe('ws://riot:tok@127.0.0.1:8777')
    expect(endpoint.isReplay).toBe(true)
  })

  it('uses a secure websocket when the override is https', () => {
    const endpoint = resolveLcuEndpoint(1, 'tok', { [LCU_ENDPOINT_ENV]: 'https://example.test:9' })

    expect(endpoint.webSocketUrl).toBe('wss://riot:tok@example.test:9')
  })

  it('ignores a malformed override rather than refusing to connect', () => {
    // A stray environment variable must not stop the application talking to a client that is
    // running perfectly well.
    const endpoint = resolveLcuEndpoint(51234, 'tok', { [LCU_ENDPOINT_ENV]: 'not a url' })

    expect(endpoint.baseUrl).toBe('https://127.0.0.1:51234')
    expect(endpoint.isReplay).toBe(false)
  })

  it('drops any path on the override', () => {
    const endpoint = resolveLcuEndpoint(1, 'tok', {
      [LCU_ENDPOINT_ENV]: 'http://127.0.0.1:8777/some/path'
    })

    expect(endpoint.baseUrl).toBe('http://127.0.0.1:8777')
  })
})
