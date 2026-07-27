import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'

import { LcuFixture, indexResponses, responseKey, validateFixture } from './lcu-fixture'

/**
 * Serves a recorded champion select as if it were a running League client.
 *
 * Runs anywhere, which is the entire point: the client itself is Windows-only and refuses to run
 * under virtualisation, so this is the only way to exercise champion-select handling end to end on
 * a machine that cannot run the game.
 *
 *   yarn lcu-replay fixtures/champ-select.json
 *   LEAGUESOL_LCU_ENDPOINT=http://127.0.0.1:8777 yarn dev
 *
 * Plain HTTP rather than the client's self-signed HTTPS: this is loopback development traffic, and
 * generating a certificate would add a dependency for no benefit. The application's endpoint
 * override carries the scheme for exactly this reason.
 */

function parseArgs(argv: string[]) {
  const positional: string[] = []
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
    } else {
      positional.push(argv[i])
    }
  }

  return {
    fixture: positional[0] ?? raw.fixture ?? 'fixtures/champ-select.json',
    port: Number(raw.port ?? 8777),
    speed: Number(raw.speed ?? 1),
    loop: raw.loop === 'true'
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const fixture: LcuFixture = validateFixture(JSON.parse(await readFile(args.fixture, 'utf8')))
  const responses = indexResponses(fixture)

  const server = createServer((req, res) => {
    const key = responseKey(req.method ?? 'GET', req.url ?? '/')
    const recorded = responses.get(key)

    if (!recorded) {
      res.statusCode = 404
      res.setHeader('content-type', 'application/json')
      res.end(
        JSON.stringify({ errorCode: 'RPC_ERROR', message: 'not in fixture', httpStatus: 404 })
      )
      return
    }

    res.statusCode = recorded.status || 200
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(recorded.body))
  })

  const wss = new WebSocketServer({ server })

  wss.on('connection', (socket) => {
    console.log('client connected; replaying events')
    const started = Date.now()
    const timers: NodeJS.Timeout[] = []

    const schedule = (round: number) => {
      for (const event of fixture.events) {
        timers.push(
          setTimeout(
            () => {
              if (socket.readyState !== socket.OPEN) {
                return
              }
              // WAMP EVENT frame, the shape the client emits and the application parses.
              socket.send(
                JSON.stringify([
                  8,
                  'OnJsonApiEvent',
                  { uri: event.uri, eventType: event.eventType, data: event.data }
                ])
              )
            },
            round * fixture.durationMs + event.offsetMs / args.speed
          )
        )
      }
    }

    schedule(0)

    if (args.loop) {
      // Keeps a short fixture useful for open-ended manual poking at the UI.
      const interval = setInterval(
        () => schedule(0),
        Math.max(1000, fixture.durationMs / args.speed)
      )
      socket.once('close', () => clearInterval(interval))
    }

    socket.on('message', (raw) => {
      // The application subscribes with a WAMP frame on connect; acknowledging is unnecessary, but
      // logging it makes a handshake problem visible rather than silent.
      console.log(`  subscribe: ${raw.toString().slice(0, 60)}`)
    })

    socket.once('close', () => {
      for (const timer of timers) {
        clearTimeout(timer)
      }
      console.log(`client disconnected after ${((Date.now() - started) / 1000).toFixed(1)}s`)
    })
  })

  server.listen(args.port, '127.0.0.1', () => {
    console.log(`replaying ${args.fixture}`)
    console.log(`  ${fixture.description}`)
    console.log(
      `  ${fixture.events.length} events, ${fixture.responses.length} responses, ` +
        `${(fixture.durationMs / 1000).toFixed(0)}s at ${args.speed}x`
    )
    console.log(`\nlistening on http://127.0.0.1:${args.port}`)
    console.log(`start the application with:`)
    console.log(`  LEAGUESOL_LCU_ENDPOINT=http://127.0.0.1:${args.port} yarn dev`)
  })
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
