/**
 * OP.GG's MCP endpoint does not answer in JSON. It answers with a schema preamble followed by a
 * constructor-call expression, in the style of a Python `repr`:
 *
 *     class LolGetChampionSynergies: champion,my_position,synergy_position,lang,data
 *     class Data: synergies
 *     class Synergie: champion_id,champion_name,...,play,win,win_rate,synergy_tier_data
 *
 *     LolGetChampionSynergies("Lulu","support","adc","en_US",Data([Synergie(117,"Lulu",...)]))
 *
 * The arguments are positional, so the preamble is load-bearing: it is the only thing that says
 * which number is `play` and which is `win`. Getting that mapping wrong would silently transpose
 * games and wins, which no downstream assertion would catch — hence a real parser and real tests
 * rather than a regular expression.
 */

export type ReprValue = string | number | boolean | null | ReprValue[] | ReprObject

export interface ReprObject {
  /** The constructor name, e.g. `Synergie`. */
  $type: string
  [field: string]: ReprValue | string
}

export class ReprParseError extends Error {}

/** `class Name: a,b,c` lines, mapping constructor name to its positional field names. */
function parseSchema(source: string): Map<string, string[]> {
  const schema = new Map<string, string[]>()
  const pattern = /^class\s+([A-Za-z_]\w*)\s*:\s*(.*)$/gm

  let match: RegExpExecArray | null
  while ((match = pattern.exec(source)) !== null) {
    const fields = match[2]
      .split(',')
      .map((f) => f.trim())
      .filter(Boolean)
    schema.set(match[1], fields)
  }

  return schema
}

class ExpressionReader {
  private _pos = 0

  constructor(
    private readonly _src: string,
    private readonly _schema: Map<string, string[]>
  ) {}

  get position(): number {
    return this._pos
  }

  skipWhitespace(): void {
    while (this._pos < this._src.length && /\s/.test(this._src[this._pos])) {
      this._pos++
    }
  }

  atEnd(): boolean {
    this.skipWhitespace()
    return this._pos >= this._src.length
  }

  readValue(): ReprValue {
    this.skipWhitespace()

    if (this._pos >= this._src.length) {
      throw new ReprParseError('unexpected end of input')
    }

    const ch = this._src[this._pos]

    if (ch === '"' || ch === "'") {
      return this._readString(ch)
    }
    if (ch === '[' || ch === '(') {
      return this._readList(ch === '[' ? ']' : ')')
    }
    if (/[A-Za-z_]/.test(ch)) {
      return this._readIdentifierOrCall()
    }
    if (/[-\d.]/.test(ch)) {
      return this._readNumber()
    }

    throw new ReprParseError(`unexpected character ${JSON.stringify(ch)} at ${this._pos}`)
  }

  private _readString(quote: string): string {
    this._pos++ // opening quote
    let out = ''

    while (this._pos < this._src.length) {
      const ch = this._src[this._pos]

      if (ch === '\\') {
        const next = this._src[this._pos + 1]
        // The transport JSON-escapes the payload, so the usual escapes appear here verbatim.
        const mapped = next === 'n' ? '\n' : next === 't' ? '\t' : next === 'r' ? '\r' : next
        out += mapped
        this._pos += 2
        continue
      }
      if (ch === quote) {
        this._pos++
        return out
      }

      out += ch
      this._pos++
    }

    throw new ReprParseError('unterminated string')
  }

  private _readNumber(): number {
    const start = this._pos
    while (this._pos < this._src.length && /[-+\d.eE]/.test(this._src[this._pos])) {
      this._pos++
    }

    const raw = this._src.slice(start, this._pos)
    const value = Number(raw)

    if (Number.isNaN(value)) {
      throw new ReprParseError(`invalid number ${JSON.stringify(raw)} at ${start}`)
    }

    return value
  }

  private _readList(closer: string): ReprValue[] {
    this._pos++ // opening bracket
    const items: ReprValue[] = []

    for (;;) {
      this.skipWhitespace()

      if (this._pos >= this._src.length) {
        throw new ReprParseError('unterminated list')
      }
      if (this._src[this._pos] === closer) {
        this._pos++
        return items
      }
      if (this._src[this._pos] === ',') {
        this._pos++
        continue
      }

      items.push(this.readValue())
    }
  }

  private _readIdentifierOrCall(): ReprValue {
    const start = this._pos
    while (this._pos < this._src.length && /[\w.]/.test(this._src[this._pos])) {
      this._pos++
    }
    const name = this._src.slice(start, this._pos)

    this.skipWhitespace()

    // A bare identifier is a literal, not a call.
    if (this._pos >= this._src.length || this._src[this._pos] !== '(') {
      if (name === 'None' || name === 'null') return null
      if (name === 'True' || name === 'true') return true
      if (name === 'False' || name === 'false') return false
      return name
    }

    const args = this._readList(')')
    const fields = this._schema.get(name)

    // Without a declared schema the positional arguments have no names; preserving them as a list
    // is more honest than inventing keys.
    if (!fields) {
      return { $type: name, $args: args } as unknown as ReprObject
    }

    const object: ReprObject = { $type: name }
    for (let i = 0; i < fields.length; i++) {
      object[fields[i]] = i < args.length ? args[i] : null
    }

    return object
  }
}

/**
 * Parses one MCP text payload into a plain object tree keyed by the declared field names.
 */
export function parseRepr(payload: string): ReprValue {
  const schema = parseSchema(payload)

  // The expression begins after the last `class ...` line.
  const lastClassLine = payload.lastIndexOf('\nclass ')
  const afterSchema =
    lastClassLine === -1
      ? payload.startsWith('class ')
        ? payload.indexOf('\n')
        : 0
      : payload.indexOf('\n', lastClassLine + 1)

  const expression = payload.slice(afterSchema === -1 ? payload.length : afterSchema)
  const reader = new ExpressionReader(expression, schema)
  const value = reader.readValue()

  return value
}
