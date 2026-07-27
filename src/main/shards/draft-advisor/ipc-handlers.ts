import type { RegionType, TierType } from '@shared/types/opgg'

import type { DraftAdvisorMainContext } from './context'

export class DraftAdvisorIpcHandlers {
  constructor(private readonly _context: DraftAdvisorMainContext) {}

  register(): void {
    const { ipc, namespace, settings, settingService, stats } = this._context

    ipc.onCall(namespace, 'setEnabled', async (_, value: boolean) => {
      settings.setEnabled(value)
      await settingService.set('enabled', value)
    })

    ipc.onCall(namespace, 'setRegion', async (_, value: RegionType) => {
      settings.setRegion(value)
      await settingService.set('region', value)
    })

    ipc.onCall(namespace, 'setTier', async (_, value: TierType) => {
      settings.setTier(value)
      await settingService.set('tier', value)
    })

    ipc.onCall(namespace, 'setLimit', async (_, value: number) => {
      settings.setLimit(value)
      await settingService.set('limit', value)
    })

    ipc.onCall(namespace, 'setOwnedOnly', async (_, value: boolean) => {
      settings.setOwnedOnly(value)
      await settingService.set('ownedOnly', value)
    })

    ipc.onCall(namespace, 'setUseProficiency', async (_, value: boolean) => {
      settings.setUseProficiency(value)
      await settingService.set('useProficiency', value)
    })

    // Lets the renderer start the multi-minute refresh deliberately, rather than only discovering
    // it is needed when a draft is already underway.
    ipc.onCall(namespace, 'prepareStatistics', async () => {
      stats.ensure(settings.region, settings.tier)
    })
  }
}
