/**
 * Where the League client's local API lives.
 *
 * Normally that is loopback HTTPS on the port the client advertises, but it can be pointed at a
 * replay server instead. The League client is Windows-only and refuses to run under
 * virtualisation, so without a way to substitute it, every change to champion-select handling can
 * only be exercised by queueing up a real game — which makes the loop slow enough that things go
 * untested. `tools/lcu-replay.ts` serves recorded traffic over plain HTTP on loopback, so the
 * override carries a scheme as well as an authority.
 */

export const LCU_ENDPOINT_ENV = 'LEAGUESOL_LCU_ENDPOINT'

export interface LcuEndpoint {
  /** Base URL for REST calls, without a trailing slash. */
  baseUrl: string
  /** URL for the event WebSocket. */
  webSocketUrl: string
  /** True when traffic is being replayed rather than served by a real client. */
  isReplay: boolean
}

/**
 * Resolves the endpoint for a set of client credentials, honouring the override when present.
 *
 * An invalid override is ignored rather than fatal: a stray environment variable should not stop
 * the application from talking to a real client that is running perfectly well.
 */
export function resolveLcuEndpoint(
  port: number | string,
  authToken: string,
  env: NodeJS.ProcessEnv = process.env
): LcuEndpoint {
  const override = env[LCU_ENDPOINT_ENV]

  if (override) {
    try {
      const url = new URL(override)
      const secure = url.protocol === 'https:'

      return {
        baseUrl: `${url.protocol}//${url.host}`,
        webSocketUrl: `${secure ? 'wss' : 'ws'}://riot:${authToken}@${url.host}`,
        isReplay: true
      }
    } catch {
      // Fall through to the real client.
    }
  }

  return {
    baseUrl: `https://127.0.0.1:${port}`,
    webSocketUrl: `wss://riot:${authToken}@127.0.0.1:${port}`,
    isReplay: false
  }
}
