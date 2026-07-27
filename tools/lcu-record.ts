import axios from 'axios'
import { readFile, writeFile } from 'node:fs/promises'
import https from 'node:https'
import WebSocket from 'ws'

import {
  LCU_FIXTURE_SCHEMA_VERSION,
  LcuFixture,
  RecordedEvent,
  RecordedResponse
} from './lcu-fixture'

/**
 * Records a champion-select session from a running League client.
 *
 * Windows only, and the only part of the replay workflow that is. Run it once, play through a
 * custom lobby, and the resulting fixture can drive the application on any machine thereafter.
 *
 *   yarn lcu-record --out fixtures/champ-select.json --description "solo queue, blue side"
 *
 * Credentials come from the client's lockfile, which needs no native module and no elevation —
 * unlike reading the process command line, which is how the application itself does it.
 */

const LOCKFILE_PATHS = [
  'C:\\Riot Games\\League of Legends\\lockfile',
  'C:\\Program Files\\Riot Games\\League of Legends\\lockfile',
  'C:\\Program Files (x86)\\Riot Games\\League of Legends\\lockfile'
]

/** Endpoints worth capturing: everything the draft advisor and the panel read. */
const ENDPOINTS = [
  '/lol-champ-select/v1/session',
  '/lol-champ-select/v1/all-grid-champions',
  '/lol-champ-select/v1/pickable-champion-ids',
  '/lol-champ-select/v1/bannable-champion-ids',
  '/lol-champ-select/v1/disabled-champion-ids',
  '/lol-summoner/v1/current-summoner',
  '/lol-gameflow/v1/session',
  '/lol-gameflow/v1/gameflow-phase'
]

interface Credentials {
  port: string
  token: string
}

async function readLockfile(explicitPath?: string): Promise<Credentials> {
  const candidates = explicitPath ? [explicitPath] : LOCKFILE_PATHS

  for (const path of candidates) {
    try {
      // Format: LeagueClient:pid:port:token:protocol
      const [, , port, token] = (await readFile(path, 'utf8')).split(':')
      if (port && token) {
        return { port, token }
      }
    } catch {
      continue
    }
  }

  throw new Error(
    `could not read the client lockfile. Pass --lockfile <path>, or --port and --token directly.\n` +
      `tried: ${candidates.join(', ')}`
  )
}

function parseArgs(argv: string[]) {
  const raw: Record<string, string> = {}
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const next = argv[i + 1]
      if (next !== undefined && !next.startsWith('--')) {
        raw[argv[i].slice(2)] = next
        i++
      } else {
        raw[argv[i].slice(2)] = 'true'
      }
    }
  }
  return raw
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const out = args.out ?? 'fixtures/champ-select.json'

  const credentials: Credentials =
    args.port && args.token
      ? { port: args.port, token: args.token }
      : await readLockfile(args.lockfile)

  const auth = `Basic ${Buffer.from(`riot:${credentials.token}`).toString('base64')}`
  const http = axios.create({
    baseURL: `https://127.0.0.1:${credentials.port}`,
    headers: { Authorization: auth },
    // The client serves a self-signed certificate; this is loopback traffic to a process the user
    // is already running.
    httpsAgent: new https.Agent({ rejectUnauthorized: false }),
    timeout: 10_000
  })

  const started = Date.now()
  const responses: RecordedResponse[] = []
  const events: RecordedEvent[] = []

  async function snapshot(): Promise<void> {
    for (const path of ENDPOINTS) {
      try {
        const response = await http.get(path)
        responses.push({ method: 'GET', path, status: response.status, body: response.data })
      } catch (error) {
        const status = (error as { response?: { status?: number } }).response?.status ?? 0
        // A 404 is meaningful: outside champion select the session endpoint genuinely has nothing,
        // and replaying that is more faithful than omitting it.
        responses.push({ method: 'GET', path, status, body: null })
      }
    }
  }

  console.log(`connected to 127.0.0.1:${credentials.port}`)
  console.log('capturing an initial snapshot...')
  await snapshot()

  const ws = new WebSocket(`wss://riot:${credentials.token}@127.0.0.1:${credentials.port}`, {
    headers: { Authorization: auth },
    rejectUnauthorized: false
  })

  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve())
    ws.once('error', reject)
  })

  // WAMP subscribe: 5 is SUBSCRIBE in the protocol the client speaks.
  ws.send(JSON.stringify([5, 'OnJsonApiEvent']))
  console.log('recording. Play through champion select, then press Ctrl+C to stop.\n')

  ws.on('message', (raw) => {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw.toString())
    } catch {
      return
    }

    if (!Array.isArray(parsed) || parsed.length < 3) {
      return
    }

    const payload = parsed[2] as { uri?: string; eventType?: string; data?: unknown }
    if (!payload?.uri) {
      return
    }

    events.push({
      offsetMs: Date.now() - started,
      uri: payload.uri,
      eventType: payload.eventType ?? 'Update',
      data: payload.data ?? null
    })

    if (events.length % 25 === 0) {
      process.stdout.write(`  ${events.length} events\r`)
    }
  })

  async function finish(): Promise<void> {
    console.log('\ncapturing a final snapshot...')
    await snapshot().catch(() => undefined)
    ws.close()

    const fixture: LcuFixture = {
      schemaVersion: LCU_FIXTURE_SCHEMA_VERSION,
      recordedAt: new Date().toISOString(),
      description: args.description ?? 'champion select recording',
      durationMs: Date.now() - started,
      responses,
      events
    }

    await writeFile(out, JSON.stringify(fixture, null, 2))
    console.log(
      `wrote ${out}: ${events.length} events, ${responses.length} responses, ` +
        `${(fixture.durationMs / 1000).toFixed(0)}s`
    )
    process.exit(0)
  }

  process.on('SIGINT', () => {
    finish().catch((error) => {
      console.error(error)
      process.exit(1)
    })
  })
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
