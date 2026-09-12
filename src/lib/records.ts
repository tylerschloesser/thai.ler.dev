import type { LineAnnotation } from '../llm/schema.js'

// Shared record contract for M1 (server, `api/**`) and M2 (client,
// `src/db/**`). Pure types/constants only — no Dexie import here so that
// `api/**` (which never imports `src/db`) and `src/db` (which re-exports
// these types) can both depend on this module. See PLAN.MD §4.3
// (Manifest) and §4.4 (AnnotationRun / data model).

// --- Sync-readiness base shape (PLAN.MD §4.4, docs/plans/P0.md §4.1) -------

export interface Base {
  id: string
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export interface Dialogue extends Base {
  title: string
  sourceText: string
  currentAnnotationId: string | null
}

export type AnnotationStatus = 'partial' | 'complete'

export interface AnnotationUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
}

// --- Run state (PLAN.MD §4.4) ----------------------------------------------

export const RUN_STATES = ['queued', 'running', 'done', 'cancelled'] as const
export type RunState = (typeof RUN_STATES)[number]

export const RUN_PROVIDERS = ['anthropic', 'fake', 'fake-slow'] as const
export type RunProvider = (typeof RUN_PROVIDERS)[number]

export interface AnnotationRun {
  state: RunState
  provider: RunProvider
  leaseUntil: string | null
  hops: number
  steps: number
  lastError: string | null
}

/**
 * Default `run` value stamped onto every pre-M1 `AnnotationRecord` by the
 * Dexie v2 `.upgrade()` and by importing a v1 snapshot (PLAN.MD §4.4): a
 * P0 record was always finished, ran synchronously in the browser against
 * the Anthropic provider, and never leased or hopped.
 */
export const LEGACY_RUN: AnnotationRun = {
  state: 'done',
  provider: 'anthropic',
  leaseUntil: null,
  hops: 0,
  steps: 0,
  lastError: null,
}

export interface AnnotationRecord extends Base {
  dialogueId: string
  model: string
  promptVersion: number
  schemaVersion: number
  lines: Array<LineAnnotation | null>
  lineErrors: Array<string | null>
  status: AnnotationStatus
  usage: AnnotationUsage
  durationMs: number
  run: AnnotationRun
}

export interface SettingRow {
  key: string
  value: unknown
  updatedAt: string
}

// --- Manifest (PLAN.MD §4.3) ------------------------------------------------

export const RECORD_KINDS = ['dialogue', 'annotation', 'settings'] as const
export type RecordKind = (typeof RECORD_KINDS)[number]

/** The one settings row group is addressed as a single record with this id. */
export const SETTINGS_RECORD_ID = 'all'

export const MANIFEST_FORMAT = 'thai.ler.dev/manifest' as const

export interface ManifestEntry {
  kind: RecordKind
  id: string
  updatedAt: string
  deletedAt: string | null
}

export interface Manifest {
  format: typeof MANIFEST_FORMAT
  version: 1
  updatedAt: string
  entries: Record<string, ManifestEntry>
}

/** Manifest `entries` key for a given record, e.g. `dialogue:<id>`. */
export function manifestKey(kind: RecordKind, id: string): string {
  return `${kind}:${id}`
}

export function emptyManifest(now: string): Manifest {
  return {
    format: MANIFEST_FORMAT,
    version: 1,
    updatedAt: now,
    entries: {},
  }
}
