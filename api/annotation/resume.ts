import { json } from '../_lib/http.js'

export const config = { maxDuration: 300 }

/**
 * Routing spike stub (PLAN.MD §5 M0 item 5): proves `api/annotation.ts` and
 * this `api/annotation/` directory coexist as `/api/annotation` and
 * `/api/annotation/resume`. M1 replaces this with the real `POST
 * /api/annotation/resume?id=` handler (PLAN.MD §4.1).
 */
export function POST(_request: Request): Response {
  return json({ stub: 'annotation/resume' }, 501)
}
