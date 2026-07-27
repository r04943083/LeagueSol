/**
 * Draft recommendation engine.
 *
 * Deliberately free of I/O, Electron and network dependencies: the entry point is
 * `advise(model, state)` — champion ids in, ranked champion ids out. Fetching and caching belong
 * to `@shared/draft-data`, and the champ-select wiring to the `draft-advisor` shard.
 *
 * That purity is not tidiness for its own sake. It is what lets the engine be developed and tested
 * on a machine with no League client — which, given the client only runs on Windows and refuses to
 * run under virtualisation, is the difference between a testable component and one that can only
 * be checked by queueing up a real game.
 */

export { buildCandidatePool, proficiencyAdjustment } from './candidates'
export type { CandidateOptions, ChampionProficiency } from './candidates'

export { DraftModel } from './model'
export type { CompileOptions, PairEffect } from './model'

export { clampWinrate, combineRatings, ratingToWinrate, winrateToRating } from './rating'

export { matchupBaseline, residual, synergyBaseline } from './residual'

export { advise, scoreCandidate } from './score'
export type { AdviseOptions, ScoreOptions } from './score'

export { estimateConcentration, evidenceWeight, shrinkWinrate } from './shrinkage'
export type { ConcentrationOptions, ObservedCell } from './shrinkage'

export { ROLES, isRole } from './types'
export type {
  ChampionPairRecord,
  ChampionRoleRecord,
  DraftPick,
  DraftState,
  DraftStats,
  Recommendation,
  Role,
  ScoreContribution
} from './types'
