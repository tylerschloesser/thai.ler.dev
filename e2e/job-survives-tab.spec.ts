import { expect, test } from './fixtures'

// PLAN.MD §4.8 `job-survives-tab`: annotation runs server-side (§4.2's
// `waitUntil` + runner), so the job keeps going after every page of the
// triggering context closes - proving the client tab is not what's driving
// it. `thai_fake_delay_ms` (`fakeDelay`) makes an 8-line job take a few
// seconds so there's something left to observe after the pages close;
// polling happens purely over `context.request` on a brand-new context (no
// page ever opens there), against `GET /api/annotation`.

test.describe('job-survives-tab', () => {
  test('an annotation started in one context finishes even after every page of that context closes', async ({
    page,
    context,
    fakeDelay,
    newContextSameNs,
  }) => {
    await fakeDelay(1000)
    await page.goto('/')

    const annotatePromise = page.waitForResponse(
      (response) =>
        response.url().includes('/api/annotate') &&
        response.request().method() === 'POST',
    )

    await page.getByRole('button', { name: 'Load sample' }).click()
    await page.getByRole('button', { name: 'Annotate' }).click()

    const annotateResponse = await annotatePromise
    expect(annotateResponse.status()).toBe(202)
    const body = (await annotateResponse.json()) as {
      annotation: { id: string }
    }
    const annotationId = body.annotation.id

    // Close every page of the triggering context immediately - no browser
    // page stays open while the job runs to completion.
    await Promise.all(context.pages().map((p) => p.close()))

    const otherContext = await newContextSameNs()
    await expect
      .poll(
        async () => {
          const res = await otherContext.request.get(
            `/api/annotation?id=${encodeURIComponent(annotationId)}`,
          )
          if (!res.ok()) return null
          const record = (await res.json()) as {
            run: { state: string }
            status: string
          }
          return record.run.state === 'done' ? record.status : null
        },
        { timeout: 15_000 },
      )
      .toBe('complete')
  })
})
