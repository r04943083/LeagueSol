import type { DraftPick, Role } from '@shared/draft-engine'
import type { ChampSelectSession, ChampSelectTeam } from '@shared/types/league-client/champ-select'

/**
 * Translation between the League client's champion-select vocabulary and the engine's.
 *
 * Pure by design so it can be tested without a client: the mapping is small but every entry is a
 * chance to silently mis-file a pick under the wrong role, which would quietly poison every synergy
 * and matchup lookup rather than fail.
 */

const ASSIGNED_POSITION_TO_ROLE: Readonly<Record<string, Role>> = Object.freeze({
  top: 'top',
  jungle: 'jungle',
  middle: 'mid',
  bottom: 'adc',
  utility: 'support'
})

/**
 * The client says `middle`/`bottom`/`utility` where the statistics say `mid`/`adc`/`support`.
 *
 * Returns null for an unassigned position, which is the normal case in blind pick, ARAM and custom
 * games — the caller must decide what to do rather than being handed a plausible guess.
 */
export function toRole(assignedPosition: string | null | undefined): Role | null {
  if (!assignedPosition) {
    return null
  }

  return ASSIGNED_POSITION_TO_ROLE[assignedPosition.toLowerCase()] ?? null
}

/**
 * A champion-select member's champion, counting a declared intent as a pick.
 *
 * Intent is what makes the advisor useful during the planning phase: a teammate hovering a champion
 * has told you what they mean to play, and waiting for the lock-in wastes most of the window in
 * which the advice could change your own pick. Returns 0 when nothing is chosen or hovered.
 */
export function pickedChampionId(
  member: Pick<ChampSelectTeam, 'championId' | 'championPickIntent'>
): number {
  return member.championId || member.championPickIntent || 0
}

export interface DraftContext {
  /** Locked or hovered allies, excluding the local player. */
  allies: DraftPick[]
  enemies: DraftPick[]
  /** The local player's role, or null when the queue does not assign positions. */
  role: Role | null
  /** What the local player currently has selected or hovered, if anything. */
  currentChampionId: number
}

/**
 * Reduces a champion-select session to the inputs the engine needs.
 *
 * Members with no champion chosen and no position assigned contribute nothing, which is the correct
 * behaviour rather than a gap: an unknown pick should not be modelled as any particular champion,
 * and the engine treats a missing pair as exactly zero.
 */
export function toDraftContext(session: ChampSelectSession): DraftContext {
  const local = session.myTeam.find((m) => m.cellId === session.localPlayerCellId) ?? null

  const collect = (members: readonly ChampSelectTeam[], skipCellId?: number): DraftPick[] => {
    const picks: DraftPick[] = []

    for (const member of members) {
      if (skipCellId !== undefined && member.cellId === skipCellId) {
        continue
      }

      const championId = pickedChampionId(member)
      const role = toRole(member.assignedPosition)

      // Both are required: a champion with no role cannot be looked up in role-scoped statistics.
      if (championId > 0 && role) {
        picks.push({ championId, role })
      }
    }

    return picks
  }

  return {
    allies: collect(session.myTeam, session.localPlayerCellId),
    enemies: collect(session.theirTeam),
    role: toRole(local?.assignedPosition),
    currentChampionId: local ? pickedChampionId(local) : 0
  }
}
