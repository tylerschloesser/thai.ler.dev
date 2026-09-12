/**
 * Test-only helper: under `tsconfig.api.json` (`types: ["node"]`, no DOM
 * lib), the global `Response.json()` types as `Promise<unknown>` rather
 * than the DOM lib's `Promise<any>`. Handler tests read arbitrary JSON
 * bodies and assert on their shape, so centralizing one cast here beats
 * repeating `as any` at every call site.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function jsonBody(res: Response): Promise<any> {
  return res.json()
}
