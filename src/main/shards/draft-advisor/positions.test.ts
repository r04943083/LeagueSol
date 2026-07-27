import type { ChampSelectSession, ChampSelectTeam } from '@shared/types/league-client/champ-select'
import { describe, expect, it } from 'vitest'

import { pickedChampionId, toDraftContext, toRole } from './positions'

function member(overrides: Partial<ChampSelectTeam> & { cellId: number }): ChampSelectTeam {
  return {
    assignedPosition: '',
    championId: 0,
    championPickIntent: 0,
    gameName: '',
    internalName: '',
    isAutofilled: false,
    isHumanoid: true,
    nameVisibilityType: 'VISIBLE',
    obfuscatedPuuid: '',
    obfuscatedSummonerId: 0,
    pickMode: 0,
    pickTurn: 0,
    playerAlias: '',
    playerType: '',
    puuid: '',
    selectedSkinId: 0,
    spell1Id: 0,
    spell2Id: 0,
    summonerId: 0,
    tagLine: '',
    team: 100,
    wardSkinId: 0,
    ...overrides
  } as ChampSelectTeam
}

function session(overrides: Partial<ChampSelectSession> = {}): ChampSelectSession {
  return {
    localPlayerCellId: 0,
    myTeam: [],
    theirTeam: [],
    actions: [],
    ...overrides
  } as unknown as ChampSelectSession
}

describe('toRole', () => {
  it('translates the client vocabulary to the statistics vocabulary', () => {
    expect(toRole('top')).toBe('top')
    expect(toRole('jungle')).toBe('jungle')
    expect(toRole('middle')).toBe('mid')
    expect(toRole('bottom')).toBe('adc')
    expect(toRole('utility')).toBe('support')
  })

  it('is case insensitive', () => {
    expect(toRole('MIDDLE')).toBe('mid')
    expect(toRole('Utility')).toBe('support')
  })

  it('returns null rather than guessing when no position is assigned', () => {
    // Normal in blind pick, ARAM and customs. Guessing would file picks under a wrong role and
    // poison every lookup downstream.
    expect(toRole('')).toBeNull()
    expect(toRole(null)).toBeNull()
    expect(toRole(undefined)).toBeNull()
    expect(toRole('nexus')).toBeNull()
  })
})

describe('pickedChampionId', () => {
  it('prefers a locked champion', () => {
    expect(pickedChampionId({ championId: 103, championPickIntent: 64 })).toBe(103)
  })

  it('falls back to a declared intent', () => {
    // Hovering is the signal that makes advice useful before lock-in.
    expect(pickedChampionId({ championId: 0, championPickIntent: 64 })).toBe(64)
  })

  it('reports nothing chosen as zero', () => {
    expect(pickedChampionId({ championId: 0, championPickIntent: 0 })).toBe(0)
  })
})

describe('toDraftContext', () => {
  it('separates allies from enemies and excludes the local player', () => {
    const context = toDraftContext(
      session({
        localPlayerCellId: 2,
        myTeam: [
          member({ cellId: 1, championId: 22, assignedPosition: 'bottom' }),
          member({ cellId: 2, championId: 117, assignedPosition: 'utility' }),
          member({ cellId: 3, championId: 64, assignedPosition: 'jungle' })
        ],
        theirTeam: [member({ cellId: 5, championId: 103, assignedPosition: 'middle' })]
      })
    )

    expect(context.role).toBe('support')
    expect(context.currentChampionId).toBe(117)
    expect(context.allies).toEqual([
      { championId: 22, role: 'adc' },
      { championId: 64, role: 'jungle' }
    ])
    expect(context.enemies).toEqual([{ championId: 103, role: 'mid' }])
  })

  it('counts hovered champions', () => {
    const context = toDraftContext(
      session({
        localPlayerCellId: 0,
        myTeam: [
          member({ cellId: 0, assignedPosition: 'utility' }),
          member({ cellId: 1, championPickIntent: 22, assignedPosition: 'bottom' })
        ]
      })
    )

    expect(context.allies).toEqual([{ championId: 22, role: 'adc' }])
  })

  it('omits members who have not chosen a champion', () => {
    // Ranked hides enemy picks until they lock; an unknown pick must contribute nothing rather
    // than being modelled as some particular champion.
    const context = toDraftContext(
      session({
        localPlayerCellId: 0,
        myTeam: [member({ cellId: 0, assignedPosition: 'top' })],
        theirTeam: [
          member({ cellId: 5, championId: 0, assignedPosition: 'top' }),
          member({ cellId: 6, championId: 103, assignedPosition: 'middle' })
        ]
      })
    )

    expect(context.enemies).toEqual([{ championId: 103, role: 'mid' }])
  })

  it('omits members with a champion but no assigned position', () => {
    const context = toDraftContext(
      session({
        localPlayerCellId: 0,
        myTeam: [
          member({ cellId: 0, assignedPosition: 'top' }),
          member({ cellId: 1, championId: 22, assignedPosition: '' })
        ]
      })
    )

    expect(context.allies).toEqual([])
  })

  it('reports a null role when the queue assigns no positions', () => {
    const context = toDraftContext(
      session({
        localPlayerCellId: 0,
        myTeam: [member({ cellId: 0, championId: 117, assignedPosition: '' })]
      })
    )

    expect(context.role).toBeNull()
    expect(context.currentChampionId).toBe(117)
  })

  it('tolerates a session where the local player is not in myTeam', () => {
    // Happens while spectating.
    const context = toDraftContext(
      session({ localPlayerCellId: 99, myTeam: [member({ cellId: 0, championId: 1 })] })
    )

    expect(context.role).toBeNull()
    expect(context.currentChampionId).toBe(0)
  })
})
