import { json } from './_lib/http.js'

export const config = { maxDuration: 300 }

/**
 * Routing spike stub (PLAN.MD §5 M0 item 5): proves `/api/annotation` (this
 * file) and `/api/annotation/<x>` (the `annotation/` directory) can coexist
 * as separate routes. M1 replaces this with the real `GET
 * /api/annotation?id=` handler (PLAN.MD §4.1).
 */
export function GET(_request: Request): Response {
  return json({ stub: 'annotation' }, 501)
}
