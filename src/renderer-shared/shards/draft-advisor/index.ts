import { Dep, IAkariShardInitDispose, Shard } from '@shared/akari-shard'
import type { RegionType, TierType } from '@shared/types/opgg'

import { AkariIpcRenderer } from '../ipc'
import { PiniaMobxUtilsRenderer } from '../pinia-mobx-utils'
import { SettingUtilsRenderer } from '../setting-utils'
import {
  DRAFT_ADVISOR_MAIN_NAMESPACE,
  DRAFT_ADVISOR_RENDERER_NAMESPACE,
  type DraftAdvisorRendererContext
} from './context'
import { syncDraftAdvisorState } from './state-sync'

@Shard(DraftAdvisorRenderer.id)
export class DraftAdvisorRenderer implements IAkariShardInitDispose {
  static id = DRAFT_ADVISOR_RENDERER_NAMESPACE

  private readonly _context: DraftAdvisorRendererContext

  constructor(
    @Dep(AkariIpcRenderer) ipc: AkariIpcRenderer,
    @Dep(PiniaMobxUtilsRenderer) piniaMobxUtils: PiniaMobxUtilsRenderer,
    @Dep(SettingUtilsRenderer) settingUtils: SettingUtilsRenderer
  ) {
    this._context = { ipc, piniaMobxUtils, settingUtils }
  }

  setEnabled(value: boolean) {
    return this._context.ipc.call(DRAFT_ADVISOR_MAIN_NAMESPACE, 'setEnabled', value)
  }

  setRegion(value: RegionType) {
    return this._context.ipc.call(DRAFT_ADVISOR_MAIN_NAMESPACE, 'setRegion', value)
  }

  setTier(value: TierType) {
    return this._context.ipc.call(DRAFT_ADVISOR_MAIN_NAMESPACE, 'setTier', value)
  }

  setLimit(value: number) {
    return this._context.ipc.call(DRAFT_ADVISOR_MAIN_NAMESPACE, 'setLimit', value)
  }

  setOwnedOnly(value: boolean) {
    return this._context.ipc.call(DRAFT_ADVISOR_MAIN_NAMESPACE, 'setOwnedOnly', value)
  }

  setUseProficiency(value: boolean) {
    return this._context.ipc.call(DRAFT_ADVISOR_MAIN_NAMESPACE, 'setUseProficiency', value)
  }

  /** Starts the statistics load ahead of a draft, rather than discovering it is needed mid-pick. */
  prepareStatistics() {
    return this._context.ipc.call(DRAFT_ADVISOR_MAIN_NAMESPACE, 'prepareStatistics')
  }

  async onInit() {
    await syncDraftAdvisorState(this._context)
  }
}
