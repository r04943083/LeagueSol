import { Shard } from '@shared/akari-shard'
import type { IAkariShardInitDispose } from '@shared/akari-shard'
import type { RegionType, TierType } from '@shared/types/opgg'
import { z } from 'zod'

import { AkariIpcMain } from '../ipc'
import { LeagueClientMain } from '../league-client'
import { AkariLogger, LoggerFactoryMain } from '../logger-factory'
import { MobxUtilsMain } from '../mobx-utils'
import { SettingFactoryMain } from '../setting-factory'
import { SetterSettingService } from '../setting-factory/setter-setting-service'
import { DraftAdvisorController } from './advisor-controller'
import { DRAFT_ADVISOR_MAIN_NAMESPACE, DraftAdvisorMainContext } from './context'
import { DraftAdvisorIpcHandlers } from './ipc-handlers'
import { DraftAdvisorSettings, DraftAdvisorState } from './state'
import { DraftStatsProvider } from './stats-provider'

/**
 * Recommends a champion for the open slot, given who has already been picked on both teams.
 *
 * The scoring itself lives in `@shared/draft-engine` and takes no dependency on Electron or the
 * client; this shard is only the wiring — read champion select, hand the engine champion ids, put
 * the ranked answer on observable state.
 */
@Shard(DraftAdvisorMain.id)
export class DraftAdvisorMain implements IAkariShardInitDispose {
  static id = DRAFT_ADVISOR_MAIN_NAMESPACE

  public readonly settings = new DraftAdvisorSettings()
  public readonly state = new DraftAdvisorState()

  private readonly _logger: AkariLogger
  private readonly _settingService: SetterSettingService
  private readonly _context: DraftAdvisorMainContext
  private readonly _stats: DraftStatsProvider
  private readonly _controller: DraftAdvisorController
  private readonly _ipcHandlers: DraftAdvisorIpcHandlers

  constructor(
    loggerFactory: LoggerFactoryMain,
    settingFactory: SettingFactoryMain,
    private readonly _leagueClient: LeagueClientMain,
    private readonly _mobxUtils: MobxUtilsMain,
    private readonly _ipc: AkariIpcMain
  ) {
    this._logger = loggerFactory.create(DraftAdvisorMain.id)

    this._settingService = settingFactory.register(
      DraftAdvisorMain.id,
      {
        enabled: { default: this.settings.enabled, schema: z.boolean() },
        region: { default: this.settings.region, schema: z.string() as z.ZodType<RegionType> },
        tier: { default: this.settings.tier, schema: z.string() as z.ZodType<TierType> },
        limit: { default: this.settings.limit, schema: z.number().int().min(1).max(50) },
        ownedOnly: { default: this.settings.ownedOnly, schema: z.boolean() },
        useProficiency: { default: this.settings.useProficiency, schema: z.boolean() }
      },
      this.settings
    )

    this._stats = new DraftStatsProvider(this._logger, (status) =>
      this.state.setStatsStatus(status)
    )

    this._context = {
      namespace: DraftAdvisorMain.id,
      settings: this.settings,
      state: this.state,
      logger: this._logger,
      settingService: this._settingService,
      leagueClient: this._leagueClient,
      mobxUtils: this._mobxUtils,
      ipc: this._ipc,
      stats: this._stats
    }

    this._controller = new DraftAdvisorController(this._context)
    this._ipcHandlers = new DraftAdvisorIpcHandlers(this._context)
  }

  async onInit() {
    await this._settingService.applyToState()

    this._mobxUtils.propSync(DraftAdvisorMain.id, 'settings', this.settings, [
      'enabled',
      'region',
      'tier',
      'limit',
      'ownedOnly',
      'useProficiency'
    ])
    this._mobxUtils.propSync(DraftAdvisorMain.id, 'state', this.state, ['result', 'statsStatus'])

    this._ipcHandlers.register()
    this._controller.watch()
  }
}
