import { ratingToWinrate, winrateToRating } from './rating'
import { matchupBaseline, residual, synergyBaseline } from './residual'
import {
  ConcentrationOptions,
  ObservedCell,
  estimateConcentration,
  evidenceWeight,
  shrinkWinrate
} from './shrinkage'
import type { ChampionPairRecord, DraftStats, Role } from './types'

/** A compiled pair term: the residual in rating points, plus how much to trust it. */
export interface PairEffect {
  rating: number
  games: number
  evidence: number
}

const NO_EFFECT: PairEffect = Object.freeze({ rating: 0, games: 0, evidence: 0 })

export interface CompileOptions {
  /** Prior for a champion's own win rate. Half, because the average game is a coin flip. */
  championPriorWinrate?: number
  championConcentration?: ConcentrationOptions
  pairConcentration?: ConcentrationOptions
  /**
   * Role pairs with fewer distinct cells than this fall back to a concentration estimated across
   * the whole table. Estimating per role pair is worth doing — bot-lane synergy really does vary
   * more than top/jungle synergy — but it needs enough cells to be stable.
   */
  minCellsPerGroup?: number
}

const DEFAULT_COMPILE_OPTIONS: Required<CompileOptions> = {
  championPriorWinrate: 0.5,
  championConcentration: {},
  pairConcentration: {},
  minCellsPerGroup: 50
}

function championKey(championId: number, role: Role): string {
  return `${championId}:${role}`
}

function pairKey(championId: number, role: Role, otherChampionId: number, otherRole: Role): string {
  return `${championId}:${role}|${otherChampionId}:${otherRole}`
}

function groupKey(role: Role, otherRole: Role): string {
  return `${role}|${otherRole}`
}

/**
 * Estimated prior weights, in games, reported per table and per role pairing.
 *
 * Worth surfacing rather than hiding inside the compile: the concentration is the single number
 * deciding how much any pair statistic is allowed to move a recommendation, and it is estimated
 * from the data. A value in the tens means the observations are trusted; a value in the thousands
 * means the engine has concluded the apparent spread between pairs is mostly sampling noise, and
 * recommendations will track raw champion strength no matter how interesting the pair table looks.
 */
export interface ConcentrationDiagnostics {
  champions: number
  synergyByRolePair: Record<string, number>
  matchupByRolePair: Record<string, number>
}

/**
 * `DraftStats` turned into constant-time lookups of ratings and residuals.
 *
 * All shrinkage and residual arithmetic happens once, here, so scoring a candidate is pure
 * addition. Compile once per patch/region/tier and reuse across every pick in a draft.
 */
export class DraftModel {
  private readonly _championRatings = new Map<string, number>()
  private readonly _championGames = new Map<string, number>()
  private readonly _synergies = new Map<string, PairEffect>()
  private readonly _matchups = new Map<string, PairEffect>()
  private readonly _championsByRole = new Map<Role, number[]>()
  private readonly _diagnostics: ConcentrationDiagnostics = {
    champions: 0,
    synergyByRolePair: {},
    matchupByRolePair: {}
  }

  get diagnostics(): ConcentrationDiagnostics {
    return this._diagnostics
  }

  private constructor(
    readonly patch: string,
    readonly region: string,
    readonly tier: string
  ) {}

  static compile(stats: DraftStats, options: CompileOptions = {}): DraftModel {
    const opts = { ...DEFAULT_COMPILE_OPTIONS, ...options }
    const model = new DraftModel(stats.patch, stats.region, stats.tier)

    // Champion base rates. These cells are large enough that shrinkage is nearly a no-op, but it
    // still matters for off-role picks — a champion with 40 games in a role it rarely plays should
    // not be handed a 61% win rate at face value.
    const championCells: ObservedCell[] = stats.champions.map((c) => ({
      games: c.games,
      wins: c.wins,
      priorMean: opts.championPriorWinrate
    }))
    const championConcentration = estimateConcentration(championCells, opts.championConcentration)
    model._diagnostics.champions = championConcentration

    for (const champion of stats.champions) {
      const key = championKey(champion.championId, champion.role)
      const winrate = shrinkWinrate(
        {
          games: champion.games,
          wins: champion.wins,
          priorMean: opts.championPriorWinrate
        },
        championConcentration
      )

      model._championRatings.set(key, winrateToRating(winrate))
      model._championGames.set(key, champion.games)

      const inRole = model._championsByRole.get(champion.role)
      if (inRole) {
        inRole.push(champion.championId)
      } else {
        model._championsByRole.set(champion.role, [champion.championId])
      }
    }

    model._compilePairs(
      stats.synergies,
      model._synergies,
      synergyBaseline,
      opts,
      model._diagnostics.synergyByRolePair
    )
    model._compilePairs(
      stats.matchups,
      model._matchups,
      matchupBaseline,
      opts,
      model._diagnostics.matchupByRolePair
    )

    return model
  }

  /**
   * Shrinks and residualises one pair table.
   *
   * The prior for each cell is the no-interaction baseline implied by the two champions' ratings,
   * so a cell with no data contributes exactly zero rather than dragging the pick toward 50%.
   */
  private _compilePairs(
    records: readonly ChampionPairRecord[],
    target: Map<string, PairEffect>,
    baseline: (championRating: number, otherRating: number) => number,
    opts: Required<CompileOptions>,
    diagnostics: Record<string, number>
  ): void {
    const baselines = new Map<string, number>()
    const cellsByGroup = new Map<string, ObservedCell[]>()
    const allCells: ObservedCell[] = []

    for (const record of records) {
      const key = pairKey(record.championId, record.role, record.otherChampionId, record.otherRole)
      const baselineRating = baseline(
        this.championRating(record.championId, record.role),
        this.championRating(record.otherChampionId, record.otherRole)
      )
      baselines.set(key, baselineRating)

      // Shrink toward the no-interaction baseline, not toward 50%. A pair with no data then
      // contributes exactly zero, instead of dragging a strong champion back to a coin flip.
      const cell: ObservedCell = {
        games: record.games,
        wins: record.wins,
        priorMean: ratingToWinrate(baselineRating)
      }
      allCells.push(cell)

      const group = groupKey(record.role, record.otherRole)
      const existing = cellsByGroup.get(group)
      if (existing) {
        existing.push(cell)
      } else {
        cellsByGroup.set(group, [cell])
      }
    }

    const globalConcentration = estimateConcentration(allCells, opts.pairConcentration)
    const concentrationByGroup = new Map<string, number>()

    for (const [group, cells] of cellsByGroup) {
      const concentration =
        cells.length >= opts.minCellsPerGroup
          ? estimateConcentration(cells, opts.pairConcentration)
          : globalConcentration
      concentrationByGroup.set(group, concentration)
      diagnostics[group] = concentration
    }

    for (const record of records) {
      const key = pairKey(record.championId, record.role, record.otherChampionId, record.otherRole)
      const baselineRating = baselines.get(key)!
      const concentration =
        concentrationByGroup.get(groupKey(record.role, record.otherRole)) ?? globalConcentration

      const winrate = shrinkWinrate(
        { games: record.games, wins: record.wins, priorMean: ratingToWinrate(baselineRating) },
        concentration
      )

      target.set(key, {
        rating: residual(winrate, baselineRating),
        games: record.games,
        evidence: evidenceWeight(record.games, concentration)
      })
    }
  }

  /**
   * A champion's standalone rating in a role. Unknown combinations return 0 — neutral — so a
   * champion missing from the stats neither gains nor loses ground.
   */
  championRating(championId: number, role: Role): number {
    return this._championRatings.get(championKey(championId, role)) ?? 0
  }

  championGames(championId: number, role: Role): number {
    return this._championGames.get(championKey(championId, role)) ?? 0
  }

  hasChampion(championId: number, role: Role): boolean {
    return this._championRatings.has(championKey(championId, role))
  }

  synergy(championId: number, role: Role, allyId: number, allyRole: Role): PairEffect {
    return this._synergies.get(pairKey(championId, role, allyId, allyRole)) ?? NO_EFFECT
  }

  matchup(championId: number, role: Role, enemyId: number, enemyRole: Role): PairEffect {
    return this._matchups.get(pairKey(championId, role, enemyId, enemyRole)) ?? NO_EFFECT
  }

  /** Champion ids with data in a role, in the order the stats supplied them. */
  championsInRole(role: Role): readonly number[] {
    return this._championsByRole.get(role) ?? []
  }
}
