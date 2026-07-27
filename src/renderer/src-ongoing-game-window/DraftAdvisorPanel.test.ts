// @vitest-environment happy-dom
import { useDraftAdvisorStore } from '@renderer-shared/shards/draft-advisor/store'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import DraftAdvisorPanel from './DraftAdvisorPanel.vue'

// i18next-vue is initialised by the app shell, not by a component test. Echoing the key plus its
// interpolations keeps assertions readable and still proves the right key and champion reach it.
vi.mock('i18next-vue', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${Object.values(params).join(',')}` : key
  })
}))

vi.mock('@renderer-shared/shards/league-client/game-data-assets', () => ({
  championIconUri: (id: number) => `/champion-icons/${id}.png`
}))

vi.mock('@renderer-shared/shards/league-client/store', () => ({
  useLeagueClientStore: () => ({
    gameData: {
      champions: {
        117: { name: 'Lulu' },
        145: { name: "Kai'Sa" },
        89: { name: 'Leona' },
        412: { name: 'Thresh' }
      }
    }
  })
}))

function recommendation(overrides: Record<string, unknown> = {}) {
  return {
    championId: 117,
    role: 'support',
    rating: 18,
    winrate: 0.526,
    owned: true,
    masteryPoints: 42_000,
    contributions: [
      { kind: 'base', rating: 11.2, games: 200_000, evidence: 1 },
      {
        kind: 'synergy',
        otherChampionId: 145,
        otherRole: 'adc',
        rating: 9.4,
        games: 1820,
        evidence: 0.8
      },
      {
        kind: 'matchup',
        otherChampionId: 89,
        otherRole: 'support',
        rating: -2.6,
        games: 900,
        evidence: 0.6
      }
    ],
    ...overrides
  }
}

function result(overrides: Record<string, unknown> = {}) {
  return {
    role: 'support',
    patch: '16.14',
    region: 'kr',
    tier: 'emerald_plus',
    statisticsAreForeign: false,
    recommendations: [recommendation()],
    generatedAt: Date.now(),
    ...overrides
  }
}

describe('DraftAdvisorPanel', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('shows each recommendation broken into its terms', async () => {
    // The decomposition is the product: a bare total is not something a player can argue with.
    const store = useDraftAdvisorStore()
    store.statsStatus = { kind: 'ready', patch: '16.14', region: 'kr', tier: 'emerald_plus' }
    store.result = result() as never

    const wrapper = mount(DraftAdvisorPanel)
    const text = wrapper.text()

    expect(text).toContain('Lulu')
    expect(text).toContain('52.6%')
    expect(text).toContain('+11.2')
    expect(text).toContain("Kai'Sa")
    expect(text).toContain('+9.4')
    expect(text).toContain('Leona')
    expect(text).toContain('-2.6')
  })

  it('exposes the sample size behind every term', async () => {
    const store = useDraftAdvisorStore()
    store.result = result() as never

    const wrapper = mount(DraftAdvisorPanel)
    const titles = wrapper.findAll('.term').map((t) => t.attributes('title'))

    expect(titles.some((t) => t?.includes('1820'))).toBe(true)
  })

  it('marks a term resting on little evidence', async () => {
    // A big number from a handful of games is a guess, and should not look like the others.
    const store = useDraftAdvisorStore()
    store.result = result({
      recommendations: [
        recommendation({
          contributions: [
            { kind: 'base', rating: 5, games: 100_000, evidence: 1 },
            {
              kind: 'synergy',
              otherChampionId: 145,
              otherRole: 'adc',
              rating: 8,
              games: 40,
              evidence: 0.05
            }
          ]
        })
      ]
    }) as never

    const wrapper = mount(DraftAdvisorPanel)
    expect(wrapper.findAll('.term.weak')).toHaveLength(1)
  })

  it('hides terms too small to matter', async () => {
    // Crowding the display with tenth-of-a-point terms buries the two that moved the ranking.
    const store = useDraftAdvisorStore()
    store.result = result({
      recommendations: [
        recommendation({
          contributions: [
            { kind: 'base', rating: 5, games: 100_000, evidence: 1 },
            {
              kind: 'matchup',
              otherChampionId: 412,
              otherRole: 'support',
              rating: 0.1,
              games: 500,
              evidence: 0.5
            }
          ]
        })
      ]
    }) as never

    const wrapper = mount(DraftAdvisorPanel)
    expect(wrapper.text()).not.toContain('Thresh')
    expect(wrapper.findAll('.term')).toHaveLength(1)
  })

  it('warns when the statistics describe another region', async () => {
    // Always the case on Tencent servers, where op.gg has no data at all.
    const store = useDraftAdvisorStore()
    store.result = result({ statisticsAreForeign: true }) as never

    const wrapper = mount(DraftAdvisorPanel)
    expect(wrapper.find('.foreign-notice').exists()).toBe(true)
    expect(wrapper.text()).toContain('draftAdvisor.foreignData')
  })

  it('does not warn when the statistics are local', async () => {
    const store = useDraftAdvisorStore()
    store.result = result({ statisticsAreForeign: false }) as never

    const wrapper = mount(DraftAdvisorPanel)
    expect(wrapper.find('.foreign-notice').exists()).toBe(false)
  })

  it('reports load progress instead of showing an empty panel', async () => {
    const store = useDraftAdvisorStore()
    store.statsStatus = { kind: 'loading', stage: 'counters', completed: 40, total: 260 }
    store.result = null

    const wrapper = mount(DraftAdvisorPanel)
    expect(wrapper.text()).toContain('draftAdvisor.loading:counters')
    expect(wrapper.text()).toContain('40/260')
  })

  it('surfaces a load failure rather than looking idle', async () => {
    const store = useDraftAdvisorStore()
    store.statsStatus = { kind: 'error', message: 'offline' }
    store.result = null

    const wrapper = mount(DraftAdvisorPanel)
    expect(wrapper.find('.state.error').exists()).toBe(true)
    expect(wrapper.text()).toContain('offline')
  })

  it('falls back to the champion id when the name is unknown', async () => {
    // Happens for a champion released after the client's cached game data.
    const store = useDraftAdvisorStore()
    store.result = result({ recommendations: [recommendation({ championId: 9999 })] }) as never

    const wrapper = mount(DraftAdvisorPanel)
    expect(wrapper.text()).toContain('9999')
  })
})
