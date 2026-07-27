/**
 * Recorded League client traffic.
 *
 * Deliberately a plain, readable JSON document rather than a wire capture: these fixtures are
 * committed, reviewed and hand-edited to construct draft situations that would be tedious to
 * produce in a real game — an enemy team that picks in an awkward order, a champion nobody owns,
 * a role left unassigned.
 */

export const LCU_FIXTURE_SCHEMA_VERSION = 1

/** A REST response the client gave, keyed by method and path. */
export interface RecordedResponse {
  method: string
  path: string
  status: number
  body: unknown
}

/** A WebSocket event, with the offset from the start of the recording. */
export interface RecordedEvent {
  /** Milliseconds since recording began. */
  offsetMs: number
  uri: string
  eventType: 'Create' | 'Update' | 'Delete' | string
  data: unknown
}

export interface LcuFixture {
  schemaVersion: number
  recordedAt: string
  /** Free-text note about what this recording contains. */
  description: string
  durationMs: number
  responses: RecordedResponse[]
  events: RecordedEvent[]
}

export function responseKey(method: string, path: string): string {
  // The client is case-insensitive about method and sensitive about path; query strings are dropped
  // because the endpoints replayed here do not vary by them.
  return `${method.toUpperCase()} ${path.split('?')[0]}`
}

/**
 * Latest recorded response for each endpoint, so a client that polls after the recording has
 * finished still gets a coherent answer instead of a 404.
 */
export function indexResponses(fixture: LcuFixture): Map<string, RecordedResponse> {
  const index = new Map<string, RecordedResponse>()

  for (const response of fixture.responses) {
    index.set(responseKey(response.method, response.path), response)
  }

  return index
}

/**
 * Events due at or before a point in the recording, in order.
 *
 * Replay is driven by elapsed time rather than by pushing everything at once, because champion
 * select is a sequence: the advisor is supposed to change its answer as picks land, and a fixture
 * that arrives in a single burst would never exercise that.
 */
export function eventsUpTo(fixture: LcuFixture, elapsedMs: number): RecordedEvent[] {
  return fixture.events.filter((event) => event.offsetMs <= elapsedMs)
}

export function validateFixture(value: unknown): LcuFixture {
  const fixture = value as LcuFixture

  if (!fixture || typeof fixture !== 'object') {
    throw new Error('fixture is not an object')
  }

  if (fixture.schemaVersion !== LCU_FIXTURE_SCHEMA_VERSION) {
    throw new Error(
      `unsupported fixture schema ${fixture.schemaVersion}, expected ${LCU_FIXTURE_SCHEMA_VERSION}`
    )
  }

  if (!Array.isArray(fixture.responses) || !Array.isArray(fixture.events)) {
    throw new Error('fixture is missing responses or events')
  }

  return fixture
}
