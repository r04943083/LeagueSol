import type { AkariIpcRenderer } from '../ipc'
import type { PiniaMobxUtilsRenderer } from '../pinia-mobx-utils'
import type { SettingUtilsRenderer } from '../setting-utils'

export const DRAFT_ADVISOR_MAIN_NAMESPACE = 'draft-advisor-main'
export const DRAFT_ADVISOR_RENDERER_NAMESPACE = 'draft-advisor-renderer'

export interface DraftAdvisorRendererContext {
  ipc: AkariIpcRenderer
  piniaMobxUtils: PiniaMobxUtilsRenderer
  settingUtils: SettingUtilsRenderer
}
