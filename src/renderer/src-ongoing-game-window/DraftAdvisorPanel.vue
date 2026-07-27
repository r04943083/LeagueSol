<template>
  <div class="draft-advisor">
    <div class="header">
      <span class="title">{{ t('draftAdvisor.title') }}</span>
      <span v-if="result" class="scope">
        {{ result.patch }} · {{ result.region }} · {{ result.tier }}
      </span>
    </div>

    <!-- op.gg has no China region, so on Tencent servers these numbers are from elsewhere. Saying
         so is not a disclaimer for its own sake: matchup and synergy differences transfer between
         regions because they follow champion kits, but absolute win rates and tier lists do not. -->
    <div v-if="result?.statisticsAreForeign" class="foreign-notice">
      {{ t('draftAdvisor.foreignData') }}
    </div>

    <div v-if="status.kind === 'loading'" class="state">
      {{ t('draftAdvisor.loading', { stage: status.stage }) }}
      <span v-if="status.total > 1" class="progress"
        >{{ status.completed }}/{{ status.total }}</span
      >
    </div>

    <div v-else-if="status.kind === 'error'" class="state error">
      {{ t('draftAdvisor.error', { message: status.message }) }}
    </div>

    <div v-else-if="!result" class="state">{{ t('draftAdvisor.waiting') }}</div>

    <ul v-else class="recommendations">
      <li v-for="(item, index) in result.recommendations" :key="item.championId" class="item">
        <span class="rank">{{ index + 1 }}</span>
        <img
          class="portrait"
          :src="championIconUri(item.championId)"
          :alt="championName(item.championId)"
        />

        <div class="body">
          <div class="row">
            <span class="name">{{ championName(item.championId) }}</span>
            <span class="winrate" :class="{ good: item.winrate >= 0.5 }">
              {{ (item.winrate * 100).toFixed(1) }}%
            </span>
          </div>

          <!-- The decomposition is the product. A bare "+18" is not actionable; the terms are what
               let a player agree or disagree with the suggestion. -->
          <div class="terms">
            <span
              v-for="(term, i) in visibleTerms(item)"
              :key="i"
              class="term"
              :class="{ negative: term.rating < 0, weak: term.evidence < 0.25 }"
              :title="termTitle(term)"
            >
              {{ termLabel(term) }}
              <b>{{ term.rating >= 0 ? '+' : '' }}{{ term.rating.toFixed(1) }}</b>
            </span>
          </div>
        </div>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import type { DraftAdvisorRecommendation } from '@shared/shards/draft-advisor'
import type { ScoreContribution } from '@shared/draft-engine'
import { useDraftAdvisorStore } from '@renderer-shared/shards/draft-advisor/store'
import { championIconUri } from '@renderer-shared/shards/league-client/game-data-assets'
import { useLeagueClientStore } from '@renderer-shared/shards/league-client/store'
import { computed } from 'vue'
import { useTranslation } from 'i18next-vue'

const { t } = useTranslation()
const store = useDraftAdvisorStore()
const lcs = useLeagueClientStore()

const result = computed(() => store.result)
const status = computed(() => store.statsStatus)

function championName(championId: number): string {
  return lcs.gameData.champions[championId]?.name ?? String(championId)
}

/**
 * Terms worth showing. A term worth a tenth of a rating point is noise on screen, and crowding out
 * the two or three that actually moved the ranking makes the decomposition less useful, not more.
 */
function visibleTerms(item: DraftAdvisorRecommendation): ScoreContribution[] {
  return item.contributions.filter((c) => c.kind === 'base' || Math.abs(c.rating) >= 0.5)
}

function termLabel(term: ScoreContribution): string {
  if (term.kind === 'base') {
    return t('draftAdvisor.term.base')
  }

  const other = championName(term.otherChampionId!)

  return term.kind === 'synergy'
    ? t('draftAdvisor.term.with', { champion: other })
    : t('draftAdvisor.term.against', { champion: other })
}

/** Sample size behind a term, so a confident-looking number backed by 40 games is inspectable. */
function termTitle(term: ScoreContribution): string {
  return t('draftAdvisor.term.games', { games: term.games })
}
</script>

<style scoped>
.draft-advisor {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  font-size: 12px;
}

.header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.header .title {
  font-weight: 700;
}

.header .scope {
  font-size: 10px;
  opacity: 0.6;
}

.foreign-notice {
  padding: 4px 6px;
  border-radius: 3px;
  font-size: 11px;
  background-color: rgba(255, 196, 0, 0.12);
  color: rgb(255, 208, 92);
}

.state {
  padding: 8px 4px;
  opacity: 0.7;
}

.state.error {
  color: rgb(255, 138, 128);
}

.state .progress {
  margin-left: 6px;
  opacity: 0.7;
}

.recommendations {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px;
  border-radius: 4px;
  background-color: rgba(255, 255, 255, 0.04);
}

.item .rank {
  width: 14px;
  text-align: right;
  font-variant-numeric: tabular-nums;
  opacity: 0.5;
}

.item .portrait {
  width: 28px;
  height: 28px;
  border-radius: 3px;
}

.item .body {
  flex: 1;
  min-width: 0;
}

.item .row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.item .name {
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.item .winrate {
  font-variant-numeric: tabular-nums;
  opacity: 0.75;
}

.item .winrate.good {
  color: rgb(129, 199, 132);
  opacity: 1;
}

.terms {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 8px;
  margin-top: 2px;
  font-size: 10px;
  opacity: 0.7;
}

.term {
  white-space: nowrap;
}

.term b {
  font-variant-numeric: tabular-nums;
  color: rgb(129, 199, 132);
}

.term.negative b {
  color: rgb(229, 115, 115);
}

/* A large rating resting on a handful of games is a guess. Dimming it is cheaper than explaining
   shrinkage in the UI, and honest about which terms to trust. */
.term.weak {
  opacity: 0.55;
  font-style: italic;
}
</style>
