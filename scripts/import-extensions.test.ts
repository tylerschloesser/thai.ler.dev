import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Regression guard for the M0 runtime fix: `@vercel/node` transpiles each
 * `.ts` file under `api/` to its own `.js` file one-to-one, without
 * bundling and without rewriting import specifiers. So every relative
 * import/export specifier under `api/`, `src/lib/`, and `src/llm/` (the
 * directories `api/**` is allowed to import from) must already spell the
 * post-transpile `.js` extension - an extensionless or `.ts` specifier
 * resolves fine under Vite/Vitest/tsx locally but 404s as
 * `ERR_MODULE_NOT_FOUND` at runtime on Vercel, since there's no bundler
 * there to paper over it.
 *
 * Scans every `.ts` file under those three roots for relative (`.`-
 * prefixed) specifiers in static `from '...'`, dynamic `import('...')`,
 * `export ... from '...'`, and bare `import '...'` forms. A `.json`
 * specifier is allowed only when the import carries `with { type: 'json' }`
 * (Node ESM's required import-attribute syntax for a real JSON import,
 * e.g. `api/_lib/providers/fake.ts`'s fixture import - M1) - a `.json`
 * specifier without it is still a violation, in a test file or not. Bare
 * package specifiers (`zod`, `@vercel/blob`, `node:fs`, ...) are ignored.
 */

const REPO_ROOT = path.resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '..',
)
const ROOTS = ['api', 'src/lib', 'src/llm']

function listTsFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...listTsFiles(full))
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      out.push(full)
    }
  }
  return out
}

interface Violation {
  file: string
  line: number
  specifier: string
}

// `from '...'` (covers `import ... from '...'` and `export ... from '...'`,
// regardless of how many lines the import/export clause spans).
const FROM_RE = /\bfrom\s+['"]([^'"]+)['"]/g
// `import('...')` (dynamic import).
const DYNAMIC_IMPORT_RE = /\bimport\(\s*['"]([^'"]+)['"]/g
// `import '...'` (bare side-effect import, no `from`).
const BARE_IMPORT_RE = /^\s*import\s+['"]([^'"]+)['"]/gm

function lineOf(content: string, index: number): number {
  return content.slice(0, index).split('\n').length
}

// How far past the end of the matched specifier to look for a trailing
// `with { type: 'json' }` import-attribute clause.
const JSON_ATTRIBUTE_WINDOW = 40
const JSON_TYPE_ATTRIBUTE_RE = /^\s*with\s*\{\s*type:\s*['"]json['"]\s*\}/

function hasJsonTypeAttribute(content: string, afterIndex: number): boolean {
  const tail = content.slice(afterIndex, afterIndex + JSON_ATTRIBUTE_WINDOW)
  return JSON_TYPE_ATTRIBUTE_RE.test(tail)
}

function findViolations(file: string): Violation[] {
  const content = readFileSync(file, 'utf8')
  const violations: Violation[] = []

  for (const re of [FROM_RE, DYNAMIC_IMPORT_RE, BARE_IMPORT_RE]) {
    re.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = re.exec(content))) {
      const specifier = match[1]
      if (specifier === undefined || !specifier.startsWith('.')) continue // bare package import
      if (specifier.endsWith('.js')) continue
      if (
        specifier.endsWith('.json') &&
        hasJsonTypeAttribute(content, match.index + match[0].length)
      ) {
        continue
      }
      violations.push({ file, line: lineOf(content, match.index), specifier })
    }
  }

  return violations
}

describe('relative import extensions', () => {
  it('every relative specifier under api/, src/lib/, src/llm/ ends in .js', () => {
    const files = ROOTS.flatMap((root) =>
      listTsFiles(path.join(REPO_ROOT, root)),
    )
    const violations = files.flatMap((file) => findViolations(file))

    if (violations.length > 0) {
      const details = violations
        .map(
          (v) =>
            `  ${path.relative(REPO_ROOT, v.file)}:${v.line} -> '${v.specifier}'`,
        )
        .join('\n')
      throw new Error(
        'Relative import/export specifiers must end in .js (Vercel ' +
          'transpiles each .ts file to .js one-to-one, without rewriting ' +
          `specifiers):\n${details}`,
      )
    }

    expect(violations).toEqual([])
  })
})
