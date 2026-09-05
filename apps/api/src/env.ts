function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`missing required env var ${name}`)
  return value
}

function choice<T extends string>(name: string, values: readonly T[], fallback: T): T {
  const value = process.env[name]
  if (!value) return fallback
  if ((values as readonly string[]).includes(value)) return value as T
  throw new Error(`invalid env var ${name}: ${value} (expected one of ${values.join(', ')})`)
}

export const env = {
  get tableName() {
    return required('TABLE_NAME')
  },
  get workerFunctionName() {
    return required('WORKER_FUNCTION_NAME')
  },
  get anthropicSecretArn() {
    return required('ANTHROPIC_SECRET_ARN')
  },
  // Backend switches for running without AWS. Each default is Lambda's existing
  // behaviour, so Lambda never needs to set these vars.
  get store(): 'dynamo' | 'memory' {
    return choice('STORE', ['dynamo', 'memory'], 'dynamo')
  },
  get modelProvider(): 'anthropic' | 'fake' {
    return choice('MODEL_PROVIDER', ['anthropic', 'fake'], 'anthropic')
  },
  get auth(): 'constant' | 'header' {
    return choice('AUTH', ['constant', 'header'], 'constant')
  },
  get fakeModelDelayMs(): number {
    const value = process.env['FAKE_MODEL_DELAY_MS']
    if (!value) return 1500
    const parsed = Number(value)
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new Error(
        `invalid env var FAKE_MODEL_DELAY_MS: ${value} (expected a non-negative number)`,
      )
    }
    return parsed
  },
  // Port for the local dev server (src/local.ts). Lambda never reads this.
  get port(): number {
    const value = process.env['PORT']
    if (!value) return 8787
    const parsed = Number(value)
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error(`invalid env var PORT: ${value} (expected a positive integer)`)
    }
    return parsed
  },
  // Overrides which user id src/seed-table.ts seeds. Optional: undefined means
  // "use the caller's default" rather than a fixed fallback, since seed.ts and
  // seed-table.ts each have a different default user to fall back to.
  get seedUserId(): string | undefined {
    return process.env['SEED_USER_ID']
  },
}

export const AWS_REGION = process.env.AWS_REGION ?? 'us-east-1'

/**
 * Local-only defaults so `pnpm --filter api start` needs no env file at all.
 * `??=` means an explicit override (a real env var, or one a test sets first)
 * always wins, and it is safe to call this before anything else touches env:
 * every getter above is lazy and re-reads `process.env` on each access.
 */
export function applyLocalDefaults(): void {
  process.env.STORE ??= 'memory'
  process.env.MODEL_PROVIDER ??= 'fake'
  process.env.AUTH ??= 'header'
}
