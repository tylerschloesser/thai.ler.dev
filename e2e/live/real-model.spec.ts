import { expect, test } from '../fixtures'
import { LineAnnotationSchema } from '../../src/llm/schema'
import { buildDialogue, getAnnotation, postAnnotate } from './liveUtils'

/**
 * `@live` (PLAN.MD §4.2/§4.8 `live/real-model`): the one spec that calls
 * the real Anthropic API, and only when explicitly asked -
 * `test.skip(process.env.E2E_REAL_MODEL !== '1', ...)` is the first thing
 * this test does, so it is a no-op (reported as "skipped") on every normal
 * `pnpm test:e2e:vercel` run and can never fire by accident. Run it once
 * per milestone that touches `src/llm` or `api/_lib/providers` (≈ $0.05 for
 * a 2-line job on `claude-sonnet-5`).
 *
 * Clears the `thai_model` cookie (the base `context` fixture sets it to
 * `fake` for every other `@live` spec) so `selectNewJobProvider` falls back
 * to the preview's real `MODEL_PROVIDER` default (`anthropic`) instead of
 * the fake provider.
 */

test.describe('live/real-model', () => {
  test(
    'a 2-line job on the real anthropic provider produces schema-valid lines',
    { tag: '@live' },
    async ({ context }, testInfo) => {
      test.skip(
        process.env['E2E_REAL_MODEL'] !== '1',
        'real model only with E2E_REAL_MODEL=1',
      )
      test.setTimeout(180_000)

      await context.clearCookies({ name: 'thai_model' })

      const sourceText =
        'พนักงาน: สวัสดีค่ะ รับอะไรดีคะ\nลูกค้า: ขอกาแฟเย็นแก้วหนึ่งครับ'
      const dialogue = buildDialogue(sourceText, 'live real-model smoke')
      const { annotation } = await postAnnotate(
        context.request,
        dialogue,
        'claude-sonnet-5',
      )
      expect(annotation.run.provider).toBe('anthropic')
      expect(annotation.lines).toHaveLength(2)

      const startedAt = Date.now()
      // Per-line "duration" here is wall-clock time from job start until
      // that line first shows up non-null on a poll - an approximation
      // bounded by the poll interval below, not a server-measured duration
      // (the record only persists an aggregate `durationMs`/`usage`, never
      // a per-line breakdown).
      const lineDoneAtMs: (number | null)[] = [null, null]

      await expect
        .poll(
          async () => {
            const record = await getAnnotation(context.request, annotation.id)
            record.lines.forEach((line, i) => {
              if (line !== null && lineDoneAtMs[i] === null) {
                lineDoneAtMs[i] = Date.now() - startedAt
              }
            })
            return record.run.state
          },
          { timeout: 150_000, intervals: [3_000] },
        )
        .toBe('done')

      const final = await getAnnotation(context.request, annotation.id)

      testInfo.annotations.push(
        { type: 'model', description: final.model },
        {
          type: 'line[0].durationMsApprox',
          description: String(lineDoneAtMs[0]),
        },
        {
          type: 'line[1].durationMsApprox',
          description: String(lineDoneAtMs[1]),
        },
        {
          type: 'usage.inputTokens',
          description: String(final.usage.inputTokens),
        },
        {
          type: 'usage.outputTokens',
          description: String(final.usage.outputTokens),
        },
        {
          type: 'usage.cacheReadTokens',
          description: String(final.usage.cacheReadTokens),
        },
        { type: 'durationMs', description: String(final.durationMs) },
      )

      expect(final.run.state).toBe('done')
      expect(final.status).toBe('complete')
      expect(final.lines).toHaveLength(2)
      for (const line of final.lines) {
        expect(line).not.toBeNull()
        LineAnnotationSchema.parse(line)
      }
    },
  )
})
