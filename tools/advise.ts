import {
  DraftStatsCache,
  FsCacheStorage,
  fetchChampionCatalog,
  fetchLatestPatch
} from '@shared/draft-data'
import type { ChampionCatalog } from '@shared/draft-data'
import { DraftModel, ROLES, advise, isRole } from '@shared/draft-engine'
import type { DraftPick, DraftStats, Role } from '@shared/draft-engine'
import { ProxyAgent, setGlobalDispatcher } from 'undici'

/**
 * Produces a recommendation from cached statistics, without starting Electron or touching the
 * League client.
 *
 *   yarn advise --role support --allies Kaisa:adc --enemies Camille:top,Ahri:mid
 *
 * Run `yarn refresh-stats` first to populate the cache.
 */

interface Args {
  role: Role
  allies: string[]
  enemies: string[]
  region: string
  tier: string
  patch?: string
  cacheDir: string
  limit: number
  diagnostics: boolean
}

function parseArgs(argv: string[]): Args {
  const raw: Record<string, string> = {}

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (token.startsWith('--')) {
      const next = argv[i + 1]
      if (next !== undefined && !next.startsWith('--')) {
        raw[token.slice(2)] = next
        i++
      } else {
        raw[token.slice(2)] = 'true'
      }
    }
  }

  const role = raw.role ?? 'support'
  if (!isRole(role)) {
    throw new Error(`--role must be one of ${ROLES.join(', ')}, received ${role}`)
  }

  const list = (value?: string) =>
    value
      ? value
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : []

  return {
    role,
    allies: list(raw.allies),
    enemies: list(raw.enemies),
    region: raw.region ?? 'kr',
    tier: raw.tier ?? 'emerald_plus',
    patch: raw.patch,
    cacheDir: raw['cache-dir'] ?? '.cache/draft-stats',
    limit: Number(raw.limit ?? 10),
    diagnostics: raw.diagnostics === 'true'
  }
}

/** `Kaisa:adc` or `Kai'Sa:adc` or `145:adc`. */
function parsePick(token: string, catalog: ChampionCatalog): DraftPick {
  const [name, roleToken] = token.split(':')

  if (!roleToken || !isRole(roleToken)) {
    throw new Error(`expected champion:role, received ${token}`)
  }

  const numeric = Number(name)
  if (Number.isFinite(numeric) && catalog.byId.has(numeric)) {
    return { championId: numeric, role: roleToken }
  }

  const normalise = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const wanted = normalise(name)

  for (const identity of catalog.byId.values()) {
    if (normalise(identity.key) === wanted || normalise(identity.name) === wanted) {
      return { championId: identity.championId, role: roleToken }
    }
  }

  throw new Error(`unknown champion ${name}`)
}

function printDiagnostics(model: DraftModel, stats: DraftStats): void {
  const d = model.diagnostics
  const cells = [...stats.synergies, ...stats.matchups].map((r) => r.games).sort((a, b) => a - b)
  const median = cells.length ? cells[Math.floor(cells.length / 2)] : 0

  console.log('\nshrinkage diagnostics (prior weight in games; higher means less trusted)')
  console.log(`  champion base      : ${d.champions.toFixed(0)}`)
  console.log(`  median pair cell   : ${median} games`)
  for (const [label, table] of [
    ['synergy', d.synergyByRolePair],
    ['matchup', d.matchupByRolePair]
  ] as const) {
    const entries = Object.entries(table).sort((a, b) => a[1] - b[1])
    for (const [pair, concentration] of entries) {
      console.log(`  ${label} ${pair.padEnd(18)}: ${concentration.toFixed(0)}`)
    }
  }
}

async function main(): Promise<void> {
  const proxy = process.env.https_proxy || process.env.HTTPS_PROXY || process.env.http_proxy
  if (proxy) {
    setGlobalDispatcher(new ProxyAgent(proxy))
  }

  const args = parseArgs(process.argv.slice(2))
  const catalog = await fetchChampionCatalog(await fetchLatestPatch())

  const cache = new DraftStatsCache(new FsCacheStorage(args.cacheDir), {
    // The cache is the whole input here; refusing to read a day-old entry would just force a
    // several-hundred-request refresh in the middle of a lookup.
    maxAgeMs: Number.MAX_SAFE_INTEGER
  })

  const patch = args.patch ?? (await fetchLatestPatch()).split('.').slice(0, 2).join('.')
  const stats = await cache.read<DraftStats>('draft-stats', {
    patch,
    region: args.region,
    tier: args.tier
  })

  if (!stats) {
    console.error(
      `no cached statistics for patch ${patch} ${args.region}/${args.tier}.\n` +
        `run: yarn refresh-stats --region ${args.region} --tier ${args.tier}`
    )
    process.exitCode = 1
    return
  }

  const model = DraftModel.compile(stats)
  const allies = args.allies.map((t) => parsePick(t, catalog))
  const enemies = args.enemies.map((t) => parsePick(t, catalog))

  const name = (id: number) => catalog.byId.get(id)?.name ?? String(id)
  const describe = (picks: DraftPick[]) =>
    picks.length ? picks.map((p) => `${name(p.championId)} (${p.role})`).join(', ') : 'none'

  console.log(`patch ${stats.patch}  ${stats.region}/${stats.tier}`)
  console.log(`picking  : ${args.role}`)
  console.log(`allies   : ${describe(allies)}`)
  console.log(`enemies  : ${describe(enemies)}`)

  if (args.diagnostics) {
    printDiagnostics(model, stats)
  }

  const results = advise(model, { allies, enemies, role: args.role }, { limit: args.limit })

  console.log('')
  for (const [index, result] of results.entries()) {
    const terms = result.contributions
      .filter((c) => c.kind !== 'base')
      .map(
        (c) =>
          `${c.kind === 'synergy' ? 'with ' : 'vs '}${name(c.otherChampionId!)} ` +
          `${c.rating >= 0 ? '+' : ''}${c.rating.toFixed(1)} (${c.games}g)`
      )
    const base = result.contributions.find((c) => c.kind === 'base')!

    console.log(
      `${String(index + 1).padStart(2)}. ${name(result.championId).padEnd(14)} ` +
        `${(result.winrate * 100).toFixed(2)}%   base ${base.rating >= 0 ? '+' : ''}${base.rating.toFixed(1)}` +
        (terms.length ? `, ${terms.join(', ')}` : '')
    )
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
