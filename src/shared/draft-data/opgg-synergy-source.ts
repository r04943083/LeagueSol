import type { ChampionPairRecord, Role } from '@shared/draft-engine'

import { ReprObject, parseRepr } from './repr-parser'

/**
 * Ally synergy from op.gg's MCP endpoint.
 *
 * This is a separate source from the champion API for a concrete reason rather than an
 * architectural one: `lol-api-champion.op.gg` returns `synergies: null` for ranked queues — it only
 * populates that field for Arena. The MCP endpoint is the only op.gg surface that publishes
 * ranked duo statistics, and unlike scraping the website it is a documented, officially released
 * interface (github.com/opgginc/opgg-mcp, MIT).
 *
 * Known limitations, both worth surfacing rather than papering over:
 *  - it returns roughly the top ten partners by games played, not the full table
 *  - it accepts no region or tier parameter, so synergy is global while the champion API's base
 *    rates are region-scoped
 */

const MCP_ENDPOINT = 'https://mcp-api.op.gg/mcp'

export interface SynergyQuery {
  /** UPPER_SNAKE_CASE champion name; see `toMcpChampionName`. */
  champion: string
  championId: number
  role: Role
  partnerRole: Role
}

export interface McpClientOptions {
  endpoint?: string
  fetchImpl?: typeof fetch
  signal?: AbortSignal
}

let requestId = 0

async function callMcpTool(
  name: string,
  args: Record<string, unknown>,
  options: McpClientOptions = {}
): Promise<string> {
  const { endpoint = MCP_ENDPOINT, fetchImpl = fetch, signal } = options

  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      // The endpoint negotiates between a plain body and an SSE stream; accept both.
      accept: 'application/json, text/event-stream'
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: ++requestId,
      method: 'tools/call',
      params: { name, arguments: args }
    }),
    signal
  })

  if (!response.ok) {
    throw new Error(`op.gg MCP request failed: ${response.status}`)
  }

  const text = await response.text()
  const payload = parseMcpEnvelope(text)

  if (payload.error) {
    throw new Error(`op.gg MCP returned an error: ${JSON.stringify(payload.error)}`)
  }

  const content = payload.result?.content
  if (!Array.isArray(content) || content.length === 0 || typeof content[0]?.text !== 'string') {
    throw new Error('op.gg MCP returned no text content')
  }

  return content[0].text
}

interface McpEnvelope {
  error?: unknown
  result?: { content?: { type: string; text?: string }[] }
}

/**
 * The endpoint may answer with a bare JSON body or with an SSE stream carrying the same JSON in a
 * `data:` frame, depending on how it feels about the request. Both are accepted.
 */
export function parseMcpEnvelope(body: string): McpEnvelope {
  const trimmed = body.trim()

  if (trimmed.startsWith('{')) {
    return JSON.parse(trimmed) as McpEnvelope
  }

  for (const line of trimmed.split('\n')) {
    if (line.startsWith('data:')) {
      const data = line.slice(5).trim()
      if (data && data !== '[DONE]') {
        return JSON.parse(data) as McpEnvelope
      }
    }
  }

  throw new Error('unrecognised op.gg MCP response envelope')
}

/**
 * Converts one synergy response into engine records.
 *
 * `win_rate` is discarded in favour of `win / play`: the engine needs raw counts to shrink, and a
 * pre-rounded rate would throw away the sample size that makes shrinkage possible.
 */
export function toSynergyRecords(
  payload: string,
  query: Pick<SynergyQuery, 'championId' | 'role' | 'partnerRole'>
): ChampionPairRecord[] {
  const root = parseRepr(payload) as ReprObject
  const data = root.data as ReprObject | undefined
  const entries = data?.synergies

  if (!Array.isArray(entries)) {
    return []
  }

  const records: ChampionPairRecord[] = []

  for (const raw of entries) {
    const entry = raw as ReprObject
    const otherChampionId = entry.synergy_champion_id
    const play = entry.play
    const win = entry.win

    if (typeof otherChampionId !== 'number' || typeof play !== 'number' || typeof win !== 'number') {
      continue
    }

    records.push({
      championId: query.championId,
      role: query.role,
      otherChampionId,
      otherRole: query.partnerRole,
      games: play,
      wins: win
    })
  }

  return records
}

export async function fetchSynergies(
  query: SynergyQuery,
  options: McpClientOptions = {}
): Promise<ChampionPairRecord[]> {
  const payload = await callMcpTool(
    'lol_get_champion_synergies',
    {
      champion: query.champion,
      my_position: query.role,
      synergy_position: query.partnerRole,
      desired_output_fields: ['*']
    },
    options
  )

  return toSynergyRecords(payload, query)
}

/**
 * Role pairings worth querying.
 *
 * Not all twenty ordered pairs carry a real interaction. Bot lane share a lane for the whole early
 * game; jungle interacts with the lanes it can path to. Top/ADC, by contrast, is mostly noise, and
 * querying it would spend requests to add nothing. This is a modelling choice, and a deliberately
 * conservative one — the pairs excluded here can never contribute, whatever the data says.
 */
export const SYNERGY_ROLE_PAIRS: readonly (readonly [Role, Role])[] = Object.freeze([
  ['adc', 'support'],
  ['support', 'adc'],
  ['jungle', 'mid'],
  ['mid', 'jungle'],
  ['jungle', 'support'],
  ['support', 'jungle'],
  ['jungle', 'top'],
  ['top', 'jungle']
])
