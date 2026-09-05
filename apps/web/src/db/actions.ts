import type { Clarification, Translation } from '@thai/schema'
import { clarifications, translations } from './collections.ts'
import { mutate } from './sync.ts'

/**
 * The domain vocabulary of the app, and the only thing components call.
 *
 * Every one of these is a plain state update. Nothing here knows that a
 * translation involves a model call — that is derived on the server from the
 * row landing in `status: 'pending'`, which is why asking for a translation and
 * deleting one are the same kind of operation from the client's point of view.
 *
 * They return void because they take effect immediately and locally; see
 * `mutate` for why waiting on the server here would be wrong.
 */

export function createTranslation(sourceText: string): void {
  const now = Date.now()
  const row: Translation = {
    id: crypto.randomUUID(),
    sourceText: sourceText.trim(),
    status: 'pending',
    lines: [],
    summary: null,
    error: null,
    createdAt: now,
    updatedAt: now,
    deleted: false,
  }
  mutate(() => translations.insert(row))
}

export function deleteTranslation(id: string): void {
  mutate(() => translations.delete(id))
}

/** Retry is not a special case: it puts the row back into the state that triggers work. */
export function retryTranslation(id: string): void {
  mutate(() =>
    translations.update(id, (draft) => {
      draft.status = 'pending'
      draft.error = null
      draft.lines = []
      draft.summary = null
    }),
  )
}

export function askClarification(input: {
  translationId: string
  lineId: string
  segmentIds: string[]
  question: string
}): void {
  const now = Date.now()
  const row: Clarification = {
    id: crypto.randomUUID(),
    translationId: input.translationId,
    lineId: input.lineId,
    segmentIds: input.segmentIds,
    question: input.question.trim(),
    status: 'pending',
    answer: null,
    error: null,
    createdAt: now,
    updatedAt: now,
    deleted: false,
  }
  mutate(() => clarifications.insert(row))
}

export function retryClarification(id: string): void {
  mutate(() =>
    clarifications.update(id, (draft) => {
      draft.status = 'pending'
      draft.error = null
      draft.answer = null
    }),
  )
}

export function deleteClarification(id: string): void {
  mutate(() => clarifications.delete(id))
}
