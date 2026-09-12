/**
 * The runner's one-continuation-hop mechanism (PLAN.MD §4.2, §10, §4.6).
 * Self-invocation is legal but undocumented on Vercel: recursion protection
 * propagates `x-vercel-id` on outbound `fetch` and 508s past an unpublished
 * hop count, hence `MAX_HOPS` in `runner.ts`. `hop()` itself never throws -
 * a network failure or non-2xx just means the job stays visibly stalled for
 * resume-on-open to pick up later.
 */

export interface HopDeps {
  /** The current request's origin; used locally and whenever `VERCEL_URL` is unset. */
  origin: string
  /** `INTERNAL_SECRET`; omitted from the header entirely when undefined. */
  internalSecret: string | undefined
  /** Restricted-to-`thai_*` cookie header from the triggering request, forwarded so a hop keeps the same test namespace/overrides. */
  testCookie: string | null
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch
}

export async function hop(
  deps: HopDeps,
  annotationId: string,
): Promise<boolean> {
  const vercelUrl = process.env['VERCEL_URL']
  const base = vercelUrl ? `https://${vercelUrl}` : deps.origin

  const headers: Record<string, string> = {}
  if (deps.internalSecret !== undefined) {
    headers['x-thai-internal'] = deps.internalSecret
  }
  const bypass = process.env['VERCEL_AUTOMATION_BYPASS_SECRET']
  if (bypass) headers['x-vercel-protection-bypass'] = bypass
  if (deps.testCookie) headers['cookie'] = deps.testCookie

  const fetchImpl = deps.fetchImpl ?? fetch

  try {
    const res = await fetchImpl(
      `${base}/api/annotation/step?id=${encodeURIComponent(annotationId)}`,
      { method: 'POST', headers },
    )
    return res.status === 202
  } catch {
    return false
  }
}
