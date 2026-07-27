/**
 * Champion identity, from Riot's Data Dragon. Free, unauthenticated, officially sanctioned, and
 * the only mapping here that is not somebody's private API.
 *
 * The engine speaks champion ids throughout. This module exists because two of the upstream data
 * sources disagree about that: op.gg's champion API takes numeric ids, but its MCP endpoint takes
 * UPPER_SNAKE_CASE names.
 */

const DDRAGON_BASE = 'https://ddragon.leagueoflegends.com'

export interface ChampionIdentity {
  championId: number
  /** Data Dragon key, e.g. `MonkeyKing`, `Khazix`. */
  key: string
  /** Display name in the requested locale, e.g. `Wukong`, `Kha'Zix`. */
  name: string
}

export interface ChampionCatalog {
  patch: string
  byId: Map<number, ChampionIdentity>
  byKey: Map<string, ChampionIdentity>
}

export async function fetchLatestPatch(fetchImpl: typeof fetch = fetch): Promise<string> {
  const response = await fetchImpl(`${DDRAGON_BASE}/api/versions.json`)

  if (!response.ok) {
    throw new Error(`Data Dragon versions request failed: ${response.status}`)
  }

  const versions = (await response.json()) as string[]

  if (!Array.isArray(versions) || versions.length === 0) {
    throw new Error('Data Dragon returned no versions')
  }

  return versions[0]
}

export async function fetchChampionCatalog(
  patch: string,
  locale = 'en_US',
  fetchImpl: typeof fetch = fetch
): Promise<ChampionCatalog> {
  const response = await fetchImpl(`${DDRAGON_BASE}/cdn/${patch}/data/${locale}/champion.json`)

  if (!response.ok) {
    throw new Error(`Data Dragon champion request failed: ${response.status}`)
  }

  const payload = (await response.json()) as {
    data: Record<string, { key: string; id: string; name: string }>
  }

  const byId = new Map<number, ChampionIdentity>()
  const byKey = new Map<string, ChampionIdentity>()

  for (const entry of Object.values(payload.data)) {
    const identity: ChampionIdentity = {
      championId: Number(entry.key),
      key: entry.id,
      name: entry.name
    }
    byId.set(identity.championId, identity)
    byKey.set(identity.key, identity)
  }

  return { patch, byId, byKey }
}

/**
 * Converts a Data Dragon key to the UPPER_SNAKE_CASE name op.gg's MCP endpoint expects.
 *
 * The transformation is mechanical — split on camel-case boundaries and upper-case — but a handful
 * of champions do not survive it, because Data Dragon's keys are not consistently camel-cased
 * (`Belveth` for Bel'Veth, `MonkeyKing` for Wukong). Those are listed explicitly rather than
 * guessed at.
 */
const MCP_NAME_OVERRIDES: Readonly<Record<string, string>> = Object.freeze({
  MonkeyKing: 'WUKONG',
  Belveth: 'BELVETH',
  Chogath: 'CHOGATH',
  Kaisa: 'KAISA',
  Khazix: 'KHAZIX',
  KogMaw: 'KOGMAW',
  LeBlanc: 'LEBLANC',
  Reksai: 'REKSAI',
  VelKoz: 'VELKOZ',
  Fiddlesticks: 'FIDDLESTICKS'
})

export function toMcpChampionName(key: string): string {
  const override = MCP_NAME_OVERRIDES[key]
  if (override) {
    return override
  }

  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/['.\s]/g, '')
    .toUpperCase()
}
