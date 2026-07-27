import type { AkariLogger } from '@main/shards/logger-factory'
import type { SetterSettingService } from '@main/shards/setting-factory/setter-setting-service'

import type { AkariIpcMain } from '../ipc'
import type { LeagueClientMain } from '../league-client'
import type { MobxUtilsMain } from '../mobx-utils'
import type { DraftAdvisorSettings, DraftAdvisorState } from './state'
import type { DraftStatsProvider } from './stats-provider'

export const DRAFT_ADVISOR_MAIN_NAMESPACE = 'draft-advisor-main'

export interface DraftAdvisorMainContext {
  namespace: string
  settings: DraftAdvisorSettings
  state: DraftAdvisorState
  logger: AkariLogger
  settingService: SetterSettingService
  leagueClient: LeagueClientMain
  mobxUtils: MobxUtilsMain
  ipc: AkariIpcMain
  stats: DraftStatsProvider
}
