import type { ChampionProficiency, Recommendation } from '@shared/draft-engine'
import { advise, proficiencyAdjustment } from '@shared/draft-engine'
import type { DraftAdvisorRecommendation } from '@shared/shards/draft-advisor'
import type { GridChamp } from '@shared/types/league-client/champ-select'
import { comparer } from 'mobx'

import type { DraftAdvisorMainContext } from './context'
import { toDraftContext } from './positions'

/**
 * Recomputes the recommendation whenever champion select changes.
 *
 * Reacts to a derived snapshot rather than the raw session so the (cheap, but not free) scoring
 * pass runs on real changes only — the session object churns constantly with timers and trade
 * state that say nothing about the draft.
 */
export class DraftAdvisorController {
  constructor(private readonly _context: DraftAdvisorMainContext) {}

  watch(): void {
    const { leagueClient, mobxUtils, settings, state, stats } = this._context

    mobxUtils.reaction(
      () => {
        if (!settings.enabled) {
          return null
        }

        const session = leagueClient.data.champSelect.session
        if (!session) {
          return null
        }

        const draft = toDraftContext(session)

        // Without an assigned position there is no role-scoped statistic to look up. Blind pick and
        // ARAM land here, and silence is the honest answer.
        if (!draft.role) {
          return null
        }

        return {
          draft,
          region: settings.region,
          tier: settings.tier,
          limit: settings.limit,
          ownedOnly: settings.ownedOnly,
          useProficiency: settings.useProficiency,
          gridChampions: leagueClient.data.champSelect.gridChampions
        }
      },
      (input) => {
        if (!input) {
          state.setResult(null)
          return
        }

        const model = stats.ensure(input.region, input.tier)
        if (!model) {
          // A refresh is running; statsStatus already tells the renderer what is happening.
          return
        }

        const proficiencies = this._proficiencies(input.gridChampions)
        const candidates = input.ownedOnly
          ? proficiencies.filter((p) => p.owned).map((p) => p.championId)
          : undefined

        const ranked = advise(
          model,
          { allies: input.draft.allies, enemies: input.draft.enemies, role: input.draft.role! },
          { candidates, limit: undefined }
        )

        const adjusted = input.useProficiency
          ? this._applyProficiency(ranked, proficiencies, input.draft.role!)
          : ranked.map((r) => this._decorate(r, input.gridChampions))

        adjusted.sort((a, b) => b.rating - a.rating)

        state.setResult({
          role: input.draft.role!,
          patch: model.patch,
          region: model.region,
          tier: model.tier,
          statisticsAreForeign: this._isForeign(model.region),
          recommendations: adjusted.slice(0, input.limit),
          generatedAt: Date.now()
        })
      },
      { delay: 300, equals: comparer.structural, fireImmediately: true }
    )
  }

  /**
   * The client already knows which champions the player owns and how much they have played them,
   * which is what makes the proficiency term free to compute.
   *
   * Mastery points stand in for games played, since the client does not expose a per-champion game
   * count here. The conversion is deliberately crude — mastery accumulates with performance as well
   * as volume — but it separates "played a lot" from "never touched", which is the distinction that
   * matters.
   */
  private _proficiencies(gridChampions: Record<number, GridChamp>): ChampionProficiency[] {
    const result: ChampionProficiency[] = []

    for (const grid of Object.values(gridChampions ?? {})) {
      if (!grid) {
        continue
      }

      result.push({
        championId: grid.id,
        owned: Boolean(grid.owned) || Boolean(grid.freeToPlay) || Boolean(grid.rented),
        // Roughly one game per 700 mastery points, capped so a one-trick does not dominate.
        games: Math.min(400, Math.round((grid.masteryPoints ?? 0) / 700))
      })
    }

    return result
  }

  private _applyProficiency(
    ranked: Recommendation[],
    proficiencies: ChampionProficiency[],
    role: DraftAdvisorRecommendation['role']
  ): DraftAdvisorRecommendation[] {
    const { stats } = this._context
    const model = stats.model
    const byId = new Map(proficiencies.map((p) => [p.championId, p]))

    return ranked.map((recommendation) => {
      const proficiency = byId.get(recommendation.championId)

      if (!model || !proficiency) {
        return { ...recommendation, owned: false, masteryPoints: 0 }
      }

      const adjustment = proficiencyAdjustment(model, proficiency, role)

      return {
        ...recommendation,
        rating: recommendation.rating + adjustment,
        // Surfaced as its own term so the player can see the advice was bent toward their pool
        // rather than wondering why a highly-rated champion is missing.
        contributions: [
          ...recommendation.contributions,
          {
            kind: 'base' as const,
            rating: adjustment,
            games: proficiency.games,
            evidence: 1
          }
        ],
        owned: proficiency.owned,
        masteryPoints: proficiency.games * 700
      }
    })
  }

  private _decorate(
    recommendation: Recommendation,
    gridChampions: Record<number, GridChamp>
  ): DraftAdvisorRecommendation {
    const grid = gridChampions?.[recommendation.championId]

    return {
      ...recommendation,
      owned: Boolean(grid?.owned),
      masteryPoints: grid?.masteryPoints ?? 0
    }
  }

  /**
   * Whether the statistics describe somewhere other than where the player is playing.
   *
   * This is always true on Tencent servers, because op.gg publishes no China data at all. The
   * renderer is expected to label the panel accordingly: matchup and synergy *differences* transfer
   * across regions, since they follow champion kits and a patch is a patch, but absolute win rates,
   * pick and ban rates and tier lists do not.
   */
  private _isForeign(_statisticsRegion: string): boolean {
    // The client reports TENCENT as the region for every China shard.
    return this._context.leagueClient.state.auth?.region === 'TENCENT'
  }
}
