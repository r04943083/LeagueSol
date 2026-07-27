import { describe, expect, it } from 'vitest'

import { ReprObject, parseRepr } from './repr-parser'

/** Trimmed from a live `lol_get_champion_synergies` response for Lulu support / ADC partner. */
const LIVE_SAMPLE = `class LolGetChampionSynergies: champion,my_position,synergy_position,lang,data
class Data: synergies
class Synergie: champion_id,champion_name,position,synergy_champion_id,synergy_champion_name,synergy_position,score_rank,score,play,win,win_rate,synergy_tier_data
class SynergyTierData: tier,rank,rank_prev,rank_prev_patch

LolGetChampionSynergies("Lulu","support","adc","en_US",Data([Synergie(117,"Lulu","SUPPORT",804,"Yunara","ADC",1,0,8177,4020,0.49,SynergyTierData(3,11,11,20)),Synergie(117,"Lulu","SUPPORT",222,"Jinx","ADC",2,0,3785,1878,0.5,SynergyTierData(2,9,9,2))]))`

describe('parseRepr', () => {
  it('maps positional arguments onto the declared field names', () => {
    // The whole reason this parser exists: `play` and `win` are adjacent integers, and swapping
    // them would invert every win rate without breaking anything visibly.
    const root = parseRepr(LIVE_SAMPLE) as ReprObject
    const data = root.data as ReprObject
    const synergies = data.synergies as ReprObject[]

    expect(root.$type).toBe('LolGetChampionSynergies')
    expect(root.champion).toBe('Lulu')
    expect(root.my_position).toBe('support')
    expect(root.synergy_position).toBe('adc')

    expect(synergies).toHaveLength(2)
    expect(synergies[0].champion_id).toBe(117)
    expect(synergies[0].synergy_champion_id).toBe(804)
    expect(synergies[0].synergy_champion_name).toBe('Yunara')
    expect(synergies[0].play).toBe(8177)
    expect(synergies[0].win).toBe(4020)
    expect(synergies[0].win_rate).toBe(0.49)
  })

  it('keeps win counts consistent with the reported win rate', () => {
    // A transposition of play/win would show up here immediately.
    const root = parseRepr(LIVE_SAMPLE) as ReprObject
    const synergies = (root.data as ReprObject).synergies as ReprObject[]

    for (const entry of synergies) {
      const play = entry.play as number
      const win = entry.win as number
      expect(win).toBeLessThanOrEqual(play)
      expect(win / play).toBeCloseTo(entry.win_rate as number, 2)
    }
  })

  it('parses nested objects', () => {
    const root = parseRepr(LIVE_SAMPLE) as ReprObject
    const first = ((root.data as ReprObject).synergies as ReprObject[])[0]
    const tier = first.synergy_tier_data as ReprObject

    expect(tier.$type).toBe('SynergyTierData')
    expect(tier.tier).toBe(3)
    expect(tier.rank).toBe(11)
    expect(tier.rank_prev_patch).toBe(20)
  })

  it('handles negative and fractional numbers', () => {
    const parsed = parseRepr('class P: a,b,c\n\nP(-3,0.75,-0.5)') as ReprObject
    expect(parsed.a).toBe(-3)
    expect(parsed.b).toBe(0.75)
    expect(parsed.c).toBe(-0.5)
  })

  it('handles literals and empty collections', () => {
    const parsed = parseRepr('class P: a,b,c,d\n\nP(None,True,False,[])') as ReprObject
    expect(parsed.a).toBeNull()
    expect(parsed.b).toBe(true)
    expect(parsed.c).toBe(false)
    expect(parsed.d).toEqual([])
  })

  it('handles strings containing commas and parentheses', () => {
    // Champion names are not always tidy: Kai'Sa, Cho'Gath, Rek'Sai.
    const parsed = parseRepr(
      'class P: name,note\n\nP("Kai\'Sa","a (tricky), name")'
    ) as ReprObject
    expect(parsed.name).toBe("Kai'Sa")
    expect(parsed.note).toBe('a (tricky), name')
  })

  it('pads missing trailing arguments with null rather than shifting fields', () => {
    const parsed = parseRepr('class P: a,b,c\n\nP(1,2)') as ReprObject
    expect(parsed.a).toBe(1)
    expect(parsed.b).toBe(2)
    expect(parsed.c).toBeNull()
  })

  it('preserves arguments of undeclared constructors instead of guessing names', () => {
    const parsed = parseRepr('class P: a\n\nP(Unknown(1,2))') as ReprObject
    const inner = parsed.a as unknown as { $type: string; $args: unknown[] }
    expect(inner.$type).toBe('Unknown')
    expect(inner.$args).toEqual([1, 2])
  })

  it('rejects malformed input rather than returning something plausible', () => {
    expect(() => parseRepr('class P: a\n\nP("unterminated')).toThrow()
    expect(() => parseRepr('class P: a\n\nP(')).toThrow()
    expect(() => parseRepr('')).toThrow()
  })
})
