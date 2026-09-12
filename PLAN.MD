# thai.ler.dev — Implementation Plan (P0)

Planned 2026-09-12. Execute in one long-running Opus session that delegates
implementation to Sonnet sub-agents (see §7). Every version number below was
verified against npm / official docs on the planning date; re-check with
`npm view <pkg> version` before installing and update this file if it drifted.

---

## 1. Goal and scope

A personal Thai-learning web app. Paste a dialogue copied from another learning
tool, run it through Claude, and get a layered annotation:
dialogue → line (speaker) → sentence → word → syllable, each level translated
and annotated with learner context (tone, pronunciation quirks, register,
particles, idioms, "this doesn't map cleanly to English", etc.).

### P0 (this plan)

- **Home `/`**: textarea to paste a dialogue, "Annotate" button, and the
  library of saved dialogues (open / rename / re-annotate / delete).
- **Dialogue `/d/$id`**: rendered annotation. Thai words as chips with
  romanization + gloss; click a word → popover with syllables (tone-colored),
  part of speech, notes. Sentence translation under each line. Display
  toggles (romanization / gloss / tone colors).
- **Settings `/settings`**: model (Opus 5 default, Sonnet 5), API-key
  override, display defaults, theme, JSON export / import.
- Everything persisted in **IndexedDB** (Dexie). State shape is sync-ready
  (UUIDs, `createdAt`/`updatedAt`, tombstones, `deviceId`, snapshot format).
- **Playwright e2e** (Chromium, parallel, < 60 s, Anthropic mocked at the
  network layer) run locally and against the Vercel preview deployment.
- **Context engineering**: small `CLAUDE.md`, path-scoped `.claude/rules/`,
  `implementer` + `verifier` Sonnet agents, permission allowlist.

### Not P0 (design for, don't build)

- Sync to Vercel Blob (needs one `api/` function; see §4.4).
- Moving the Anthropic call server-side.
- Audio / TTS, spaced repetition, flashcards, per-word "ask a question".
- IPA romanization (schema leaves room; see §4.3).
- Dialogue-level summary (`title` is derived + editable in P0).

### Decisions confirmed with Tyler (2026-09-12)

| Question | Decision |
|---|---|
| Default annotation model | `claude-opus-5` (selectable in Settings; `claude-sonnet-5` alternative) |
| Romanization | Paiboon-style with tone diacritics (à â á ǎ, unmarked = mid; doubled vowel = long) |
| P0 scope | Paste page **plus** saved library, settings, export/import |
| Deploy target | Keep working on branch `vercel`; verify against **preview** deployments behind Vercel SSO using a Protection Bypass secret. Production untouched. |

### Findings that shaped the plan

- `origin/main` is an unrelated, earlier attempt (AWS CDK + DynamoDB + Lambda,
  TanStack DB + offline outbox, Opus 5 structured outputs). It is what
  currently serves https://thai.ler.dev (S3/CloudFront). This branch is a
  clean restart; prior-art lessons are folded into §4 and §6. Do not merge
  `main` into `vercel`.
- The Vercel project `thai-ler-dev` is **CLI-linked, not Git-connected**
  (`.vercel/repo.json`, deployments made by `vercel deploy`). Preview and
  production `*.vercel.app` deployment URLs redirect to Vercel SSO
  (Standard Protection). The production alias `thai-ler-dev.vercel.app` is
  **public** — never deploy with `--prod` while the API key is in the bundle.
- No Vercel project env vars exist yet. `ANTHROPIC_API_KEY` is set in Tyler's shell.
- A **Protection Bypass for Automation** secret was generated on 2026-09-12
  and is in the gitignored `.env.local` as `VERCEL_AUTOMATION_BYPASS_SECRET`.
  Verified: it matches the project's stored secret (via
  `vercel api /v9/projects/<id>?teamId=<team>` → `protectionBypass`) and a
  request with the `x-vercel-protection-bypass` header reaches the preview
  page with 200. Note `vercel env pull` does **not** include this secret
  (it only writes system/git vars), so never "fix" a missing secret by
  pulling; re-verify with `vercel api` instead.

---

## 2. Stack (versions verified 2026-09-12)

| Area | Choice | Version | Notes |
|---|---|---|---|
| Build | Vite | 8.2.x (installed) | `build.target` default is baseline-widely-available → native CSS nesting, `light-dark()`, `color-mix()` |
| UI | React | 19.2.x (installed) | |
| Lang | TypeScript | 6.0.x (installed) | `erasableSyntaxOnly` + `verbatimModuleSyntax`: no `enum`, `import type` for types |
| Lint / format | oxlint (installed) + Prettier | prettier 3.9.6 | Prettier: `semi: false, singleQuote: true, trailingComma: 'all'` (matches template style) |
| Components | `@base-ui/react` | 1.8.0 | Package was renamed from `@base-ui-components/react` (stale at 1.0.0-rc.0). Unstyled, `data-*` state attrs, `render` prop. Needs `isolation: isolate` on `#root`. No Textarea primitive (use native). |
| Styling | CSS Modules | built-in | Optional: `vite-css-modules` 1.16.0 for generated `.d.ts` (drop if it fights Vite 8) |
| Colors | `@radix-ui/colors` | 3.0.0 | Plain CSS files; 12-step semantic scale. Sand (neutral) + Teal (accent) + Grass/Amber/Tomato/Blue |
| Fonts | `@fontsource/noto-sans-thai`, `@fontsource/sarabun` | 5.3.0 | Self-hosted. Sarabun (looped) for Thai reading text, Noto Sans Thai fallback |
| Routing | `@tanstack/react-router` + `@tanstack/router-plugin` | 1.170.35 / 1.168.37 | File-based, `autoCodeSplitting`. Devtools `@tanstack/react-router-devtools` 1.167.1 |
| Async | `@tanstack/react-query` (+devtools) | 5.102.8 | `useMutation` for the LLM pipeline; later for Blob sync. **Not** the persistence layer. |
| Forms | `@tanstack/react-form` | 1.33.5 | Settings form, rename dialog. Zod validators. |
| Storage | `dexie` + `dexie-react-hooks` | 4.4.6 / 4.4.0 | IndexedDB source of truth; `useLiveQuery` for reactive reads; versioned migrations |
| LLM | `@anthropic-ai/sdk` | 0.125.0 | Browser: `dangerouslyAllowBrowser: true` (SDK adds the CORS header itself). `messages.stream` + `zodOutputFormat` from `@anthropic-ai/sdk/helpers/zod` |
| Schema | `zod` | 4.6.2 | SDK helper uses `zod/v4` semantics |
| Unit tests | `vitest` | 5.0.0 | Pure modules only: schema, splitter, snapshot merge, SSE helper, prompt builder |
| E2E | `@playwright/test` | 1.63.0 | Chromium only |
| Deploy | Vercel CLI | 56.4.1 installed (59.16.0 latest; `bun i -g vercel` to upgrade, optional) | `vercel deploy --yes` prints the preview URL |
| Package manager | pnpm | 11.25.0 | Add `"packageManager": "pnpm@11.25.0"` |

**TanStack DB was evaluated and rejected for P0**: pre-1.0 (0.9.0), no
official IndexedDB collection (localStorage-scale only), and the prior attempt
on `main` hit unresolved bugs with it. Revisit after 1.0 if an IDB collection
ships. TanStack Query persisters are cache revival, not durable storage —
also not used for app state.

---

## 3. Repository layout (target)

```
.
├── CLAUDE.md                     # < 80 lines: orientation, commands, hard rules
├── PLAN.MD                       # this file (executor updates status markers)
├── README.md
├── .claude/
│   ├── settings.json             # permission allowlist (§6.4)
│   ├── rules/                    # path-scoped context (§6.2)
│   │   ├── ui.md  data.md  llm.md  testing.md  deploy.md
│   └── agents/
│       ├── implementer.md        # sonnet
│       └── verifier.md           # sonnet
├── vercel.json                   # SPA rewrite
├── vite.config.ts  playwright.config.ts  vitest.config.ts
├── .prettierrc  .oxlintrc.json  tsconfig*.json
├── e2e/
│   ├── fixtures.ts               # test.extend: Anthropic mock + db seed helpers
│   ├── mocks/anthropic.ts        # route handler + SSE builder
│   └── *.spec.ts
├── scripts/
│   ├── gen-fixture.ts            # one real Opus run → src/fixtures/sample.annotation.json
│   └── e2e-vercel.sh             # deploy preview, run e2e against it
└── src/
    ├── main.tsx                  # providers + RouterProvider
    ├── routeTree.gen.ts          # generated (commit it)
    ├── routes/                   # __root.tsx  index.tsx  d.$id.tsx  settings.tsx
    ├── app/                      # router.ts, providers.tsx, theme.ts, debug.ts (window.__thai)
    ├── styles/                   # reset.css primitives.css tokens.css global.css fonts.ts
    ├── ui/                       # Base UI wrappers: Button Dialog Popover Toast Select Toggle Field Textarea
    ├── db/                       # db.ts (Dexie) repo.ts snapshot.ts settings.ts meta.ts
    ├── llm/                      # client.ts schema.ts prompt.ts split.ts annotateLine.ts pipeline.ts
    ├── features/
    │   ├── dialogues/            # Composer DialogueList DialogueView LineView WordChip WordPopover SyllableRow
    │   ├── annotate/             # useAnnotate (mutation + progress), AnnotateStatus
    │   └── settings/             # SettingsForm, ExportImport
    ├── fixtures/                 # sample.dialogue.txt, sample.annotation.json (committed)
    └── lib/                      # ids.ts time.ts tone.ts thai.ts (Intl.Segmenter helpers)
```

---

## 4. Architecture

### 4.1 Data model (Dexie, `src/db/db.ts`)

All records carry the sync-readiness fields. IDs are `crypto.randomUUID()`.
Timestamps are ISO-8601 strings. Deletes are soft (`deletedAt`), queries
filter `deletedAt === null`. Hard-purge tombstones older than 90 days on
startup (later: only after sync has confirmed them).

```ts
interface Base { id: string; createdAt: string; updatedAt: string; deletedAt: string | null }

interface Dialogue extends Base {
  title: string                 // derived from first line, user-editable
  sourceText: string            // exactly what was pasted
  currentAnnotationId: string | null
}

interface AnnotationRecord extends Base {
  dialogueId: string
  model: string                 // e.g. 'claude-opus-5'
  promptVersion: number         // PROMPT_VERSION at time of run
  schemaVersion: number         // ANNOTATION_SCHEMA_VERSION
  lines: Array<LineAnnotation | null>   // index-aligned with split(sourceText)
  lineErrors: Array<string | null>
  status: 'partial' | 'complete'
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number }
  durationMs: number
}

interface SettingRow { key: string; value: unknown; updatedAt: string }   // table 'settings'
interface MetaRow    { key: 'deviceId' | 'schemaVersion'; value: string } // table 'meta'
```

Tables/indexes: `dialogues: id, updatedAt, deletedAt`,
`annotations: id, dialogueId, updatedAt`, `settings: key`, `meta: key`.
Annotations live in their own table so the library list never loads the
large JSON blobs. Keeping old annotations gives re-annotate history for free.

**Repository API** (`src/db/repo.ts`) is the only write path components use:
`createDialogue`, `renameDialogue`, `softDeleteDialogue`, `listDialogues`
(live), `getDialogue`, `getAnnotation`, `upsertAnnotationLine`,
`finalizeAnnotation`, `setCurrentAnnotation`. Every write bumps `updatedAt`.

**Snapshot** (`src/db/snapshot.ts`) — the export format *is* the future sync
payload:

```ts
interface Snapshot {
  format: 'thai.ler.dev/snapshot'; schemaVersion: number
  exportedAt: string; deviceId: string
  dialogues: Dialogue[]; annotations: AnnotationRecord[]; settings: SettingRow[]
}
mergeSnapshot(local, incoming) // per-record last-writer-wins by updatedAt; tombstones win ties
```

Import = merge (never wipe). Export = download `thai-ler-dev-<date>.json`.
Unit-test the merge (LWW, tombstone resurrection prevention, unknown
schemaVersion → refuse with message).

Settings keys: `model`, `apiKeyOverride`, `showRomanization`, `showGloss`,
`toneColors`, `theme` (`system|light|dark`), `thaiFontScale`.

### 4.2 LLM pipeline (`src/llm/`)

**Per-line, parallel calls** rather than one giant call. Reasons: Opus output
is slow (a 15-line dialogue in one call is tens of thousands of output tokens
→ many minutes with no partial result); per-line calls run concurrently
(limit 4), render progressively, persist as they land, and retry/resume
individually. Cross-line context is preserved by sending the whole dialogue
in every request as a **cached prefix**.

1. `split.ts` — deterministic: split `sourceText` on newlines, drop blanks,
   extract `speaker` with `/^([^:：]{1,24})[:：]\s*/`. Pure, unit-tested.
   (Fallback for a single paragraph: one line; the model splits sentences.)
2. `prompt.ts` — `PROMPT_VERSION`, `SYSTEM_PROMPT` (stable, cache_control
   ephemeral), `buildUserMessage(dialogueLines, lineIndex)` = full dialogue
   in `<dialogue>` (stable per dialogue → second cache breakpoint) followed
   by `<target line="N">…</target>` and the instruction "annotate only the
   target line".
3. `schema.ts` — zod schema for structured output (below).
4. `annotateLine.ts` — one call: `client.messages.stream({...})`,
   `await stream.finalMessage()` → `parsed_output`; post-validate invariants
   (word `thai` concatenation reproduces the sentence with spaces removed;
   syllables reproduce the word) and attach `warnings[]` instead of failing.
   Handle `stop_reason === 'refusal'` and `max_tokens` as errors with
   readable messages. Map SDK error classes (`AuthenticationError`,
   `RateLimitError`, `APIConnectionError`, …) to user-facing text.
5. `pipeline.ts` — `annotateDialogue(dialogue, {model, signal, onLine})`:
   creates the `AnnotationRecord` (status `partial`), runs lines through a
   concurrency-4 queue, `upsertAnnotationLine` as each finishes, finalizes.
   `resumeAnnotation` re-runs only `null` lines. Abort via `AbortController`
   → `stream.abort()`.
6. `client.ts` — `new Anthropic({ apiKey, dangerouslyAllowBrowser: true })`.
   Key resolution: Settings override → `import.meta.env.ANTHROPIC_API_KEY`.
   Vite exposes it via `envPrefix: ['VITE_', 'ANTHROPIC_API_KEY']`.

Request shape (per line):

```ts
client.messages.stream({
  model,                              // 'claude-opus-5' | 'claude-sonnet-5'
  max_tokens: 16000,
  system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
  messages: [{ role: 'user', content: [
    { type: 'text', text: dialogueBlock, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: targetBlock },
  ]}],
  output_config: { format: zodOutputFormat(LineAnnotationSchema) },
}, { signal })
```

Thinking is adaptive by default on Opus 5 / Sonnet 5 — do not pass
`thinking`; do not pass `temperature`. Leave `output_config.effort` at the
default for P0 (a Settings knob later). Server-side refusal `fallbacks` are
**not** enabled in P0: they need the beta endpoint, complicate `parse`, and
dialogue annotation is benign; revisit only if a refusal is ever observed.

**Structured-output constraints** (verified): every property `required`,
`additionalProperties: false`, no recursion, `minItems` only 0/1, no numeric
or string-length constraints (the SDK strips them into descriptions). Use
`.nullable()` not `.optional()`. Fixed 4-level nesting is fine.

```ts
export const TONES = ['mid', 'low', 'falling', 'high', 'rising'] as const
export const NOTE_KINDS = ['common_phrase', 'pronunciation', 'spelling_mismatch',
  'particle', 'register', 'classifier', 'loanword', 'compound', 'idiom',
  'colloquial', 'no_equivalent', 'grammar', 'culture', 'other'] as const
export const POS = ['noun', 'verb', 'adjective', 'adverb', 'pronoun', 'particle',
  'classifier', 'preposition', 'conjunction', 'question_word', 'number', 'name',
  'interjection', 'other'] as const

const Note = z.object({ kind: z.enum(NOTE_KINDS), text: z.string() })
const Syllable = z.object({
  thai: z.string(), romanization: z.string(), tone: z.enum(TONES),
  toneExplanation: z.string().nullable(),   // "low-class initial ค + live syllable + mai tho → high"
  meaning: z.string().nullable(),           // only when the syllable is a meaningful morpheme
})
const Word = z.object({
  thai: z.string(), romanization: z.string(), gloss: z.string(),
  partOfSpeech: z.enum(POS), syllables: z.array(Syllable), notes: z.array(Note),
})
const Sentence = z.object({
  thai: z.string(), romanization: z.string(), translation: z.string(),
  literal: z.string().nullable(),           // word-by-word rendering when it differs usefully
  words: z.array(Word), notes: z.array(Note),
})
export const LineAnnotationSchema = z.object({
  speaker: z.string().nullable(), thai: z.string(), translation: z.string(),
  sentences: z.array(Sentence), notes: z.array(Note),
})
```

System prompt content (write it once in `prompt.ts`; keep it stable for
caching): role (Thai tutor for an English-speaking beginner); segmentation
rules (particles, classifiers, compounds are their own words; concatenation
invariants); Paiboon romanization spec (consonants `bp dt ng`, vowel length
by doubling, tone diacritics à â á ǎ, no diacritic = mid, never encode tone in
consonant spelling); the compact tone-rule table (consonant class × live/dead
× vowel length × tone mark) so `toneExplanation` is consistent; note policy
("a note must earn its place — never restate the gloss; prefer 0–2 notes per
word; sentence notes for register/usage/frequency"); translation style
(natural English at sentence level; `literal` only when it teaches
something). Store the tone table in `src/lib/tone.ts` too, for a UI "why this
tone" explainer.

**Fixture**: `scripts/gen-fixture.ts` (Node, real key) runs the pipeline on
`src/fixtures/sample.dialogue.txt` (a real 6–8 line beginner dialogue, e.g.
ordering food) and writes `sample.annotation.json`. Run once, commit. It
powers the "Load sample" button, the e2e mock, and future prompt evals.
Re-run when `PROMPT_VERSION` or the schema changes.

### 4.3 UI

- **Layout**: single column, max-width ~72ch, top bar (logo/title, nav:
  Library · Settings, theme toggle). Mobile-first; Thai text gets
  `lang="th"`, `font-family: var(--font-thai)`, `line-height: 1.9`,
  `word-break: keep-all`, base size 1.25rem for word chips.
- **Home**: Composer (textarea, "Annotate" primary button, "Load sample"
  link, line count). Submitting creates the dialogue, starts the pipeline,
  navigates to `/d/$id` immediately; progress shows there.
- **DialogueView**: title (inline rename), meta line (model, date,
  re-annotate, delete, export this dialogue), `AnnotateStatus` (N/M lines,
  cancel, retry failed lines), then `LineView` per line: speaker label,
  word chips (Thai on top, romanization, gloss underneath as toggled),
  sentence translation. Word chip click → Base UI **Popover**: word header,
  syllable rows with `ToneBadge` (color + name), tone explanation, POS,
  notes grouped by kind. Sentence-level notes shown as a collapsible row.
  Tone colors (Okabe-Ito, colorblind-safe): mid `#0072B2`, low `#009E73`,
  falling `#D55E00`, high `#E69F00`, rising `#CC79A7`; lighten ~12% L in
  dark mode.
- **Library**: list sorted by `updatedAt` desc; each row: title, first
  line, line count, status chip (complete / partial / failed), open, menu
  (rename, delete → Base UI AlertDialog).
- **Settings**: TanStack Form; Select for model and theme; password field
  for API key override; toggles for display defaults; Export button;
  Import (file input → merge → toast with counts).
- **Feedback**: Base UI Toast provider at root for errors and import
  results. Empty states for no dialogues / no key configured.
- **Debug hook**: `window.__thai = { db, importSnapshot, exportSnapshot }`
  (always on; used by e2e seeding).

### 4.4 Design tokens (`src/styles/`)

`@layer reset, tokens, base, components;` in `global.css`. `reset.css` =
Josh Comeau reset (+ `#root { isolation: isolate }` for Base UI portals).
`primitives.css` imports Radix `sand`, `sand-dark`, `teal`, `teal-dark`,
`grass`, `amber`, `tomato`, `blue` (+dark). `tokens.css` maps semantic names
with `light-dark()`; `:root { color-scheme: light dark }` and
`[data-theme=light|dark] { color-scheme: … }` for the override (set
pre-paint by an inline script in `index.html` reading localStorage). Token
families: `--color-{bg,bg-subtle,surface,border,border-strong,fg,fg-muted,
accent,accent-hover,accent-fg,success,warning,danger,info}`,
`--tone-{mid,low,falling,high,rising}`, `--space-1..8` (0.25rem base),
`--radius-1..3`, `--text-0..5` (1.25 modular scale), `--font-sans`,
`--font-thai`, `--shadow-1..2`, `--dur-1..2`, `--ease`. Components use
semantic tokens only, never Radix vars.

### 4.5 Sync-readiness (future Vercel Blob)

Not built in P0, but the P0 shape makes it a small follow-up:
`api/sync.ts` (one Vercel function, `@vercel/blob` 2.8.0, private access,
`allowOverwrite: true`, short `cacheControlMaxAge` or `useCache: false`)
storing one `Snapshot` per user; client pulls → `mergeSnapshot` → pushes
merged. LWW + tombstones already exist; `deviceId` already tagged.

### 4.6 Testing

- **Vitest** (`pnpm test`): `split`, `schema` (fixture validates; invariant
  checker flags a deliberately broken sample), `snapshot.merge`, `prompt`
  (deterministic output for caching), `e2e/mocks/anthropic` SSE builder
  round-trips through the real SDK with a stubbed `fetch`.
- **Playwright** (`pnpm test:e2e`, target < 60 s wall-clock):
  `fullyParallel: true`, Chromium only, `webServer` = `vite preview` on 4173
  unless `PLAYWRIGHT_BASE_URL` is set, `trace: 'on-first-retry'`,
  `retries: 0` locally / 1 against Vercel.
  `e2e/fixtures.ts` extends `test` with: `context.route('https://api.anthropic.com/v1/messages', handler)`
  by default (handler parses `postDataJSON()`, finds the `<target>` line
  text, replies with the matching `sample.annotation.json` line as an SSE
  body: `message_start` → `content_block_start(text)` → `content_block_delta`
  chunks → `content_block_stop` → `message_delta(end_turn)` → `message_stop`),
  plus `seed(snapshot)` via `page.evaluate(window.__thai.importSnapshot)`.
  Tests never touch the real API; a test that observes an unmocked request
  to `api.anthropic.com` fails.
  Specs (P0): `smoke` (home renders, nav), `annotate` (paste sample →
  Annotate → `/d/:id` → all lines rendered, romanization/gloss visible,
  status complete), `word-popover` (click chip → syllables, tone badges,
  notes), `library` (seed 2 → list → rename → delete with confirm → reload
  persists), `persistence` (annotate → reload → still there), `errors`
  (route returns 429/500 → toast + line marked failed + retry succeeds),
  `settings` (model change persists; export triggers download with valid
  snapshot; import merges), `theme` (toggle sets `data-theme`, persists),
  `deep-link` (`/d/unknown` shows not-found; direct load of `/settings`
  works — this validates the Vercel rewrite when run remotely).
- **Against Vercel**: `scripts/e2e-vercel.sh` runs `vercel deploy --yes`,
  parses the deployment URL out of the CLI's JSON stdout envelope, then
  `PLAYWRIGHT_BASE_URL=$url pnpm exec playwright test`. Playwright
  `extraHTTPHeaders` sends `x-vercel-protection-bypass:
  $VERCEL_AUTOMATION_BYPASS_SECRET` and `x-vercel-set-bypass-cookie: true`.

### 4.7 Deploy

- `vercel.json`: `{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }`.
- Env: `printf '%s' "$ANTHROPIC_API_KEY" | vercel env add ANTHROPIC_API_KEY preview`
  (executor does this; value never printed). Never add to `production`.
- Flow per milestone: `pnpm check && pnpm test && pnpm test:e2e` → commit →
  `git push origin vercel` → `pnpm test:e2e:vercel` (deploys a preview and
  runs the suite against it). The repo is not Git-connected on Vercel, so
  the CLI deploy is the deployment; pushing keeps GitHub as source of truth.
  Optionally run `vercel git connect` once so pushes also auto-deploy.

---

## 5. Milestones

Status markers for the executor: `[ ]` todo, `[~]` in progress, `[x]` done +
verified. Each milestone ends with: `pnpm check && pnpm test && pnpm test:e2e`
green, a commit, a push, and (M0 and M5 at minimum, ideally every
milestone) `pnpm test:e2e:vercel` green.

### M0 — Baseline, tooling, context, deploy loop `[x]`  (serial, ~1 agent)

Goal: the entire commit → push → deploy → e2e-on-Vercel loop works before any
feature code exists.

1. Commit the pending `.gitignore` change (`.vercel`, `.env*`).
2. Remove Vite template content (`App.tsx/App.css/index.css/assets`,
   `public/icons.svg`); keep `favicon.svg`.
3. Install all deps from §2 (exact versions), add `packageManager`, scripts:
   `dev build preview lint typecheck format format:check test test:e2e
   test:e2e:vercel check deploy:preview`. `check` = lint + typecheck +
   format:check. Prettier config. `.oxlintrc.json`: keep, add `import`
   plugin if cheap.
4. `vite.config.ts`: router plugin (before react), `envPrefix`, css modules
   `localsConvention: 'camelCaseOnly'`.
5. Minimal router: `__root.tsx` (shell + Outlet), `index.tsx` ("thai.ler.dev"
   heading + placeholder), `settings.tsx` placeholder, `d.$id.tsx`
   placeholder. Commit `routeTree.gen.ts`.
6. `vercel.json`; `printf '%s' "$ANTHROPIC_API_KEY" | vercel env add ANTHROPIC_API_KEY preview`.
   Confirm `VERCEL_AUTOMATION_BYPASS_SECRET` is in `.env.local` (it is, as
   of planning) and still matches the project:
   `vercel api "/v9/projects/prj_mZ6rdu95y6OVvaHsmqpDkibFXKIv?teamId=team_4mFhw0OaMx19wdVvfq9sEZuX"`
   → `protectionBypass` keys. Do **not** run `vercel env pull .env.local`
   (it would overwrite the file without the secret). If the secret is ever
   missing, ask Tyler to regenerate it in the dashboard (Settings →
   Deployment Protection → Protection Bypass for Automation) and paste it.
7. Playwright config + `e2e/fixtures.ts` skeleton + `smoke.spec.ts` +
   `deep-link.spec.ts`. Vitest config + one trivial test.
8. `scripts/e2e-vercel.sh`.
9. Context files (§6): `CLAUDE.md`, `.claude/rules/*`, `.claude/agents/*`,
   `.claude/settings.json`. Rules may reference not-yet-existing paths only
   if phrased as "will live at"; verifier rejects stale claims.
10. Verify: local suite green; `pnpm test:e2e:vercel` green (proves SSO
    bypass, SPA rewrite, env var plumbing). Commit + push.

### M1 — Design system and UI kit `[~]`  (parallel-safe: touches `src/styles`, `src/ui`, `src/app/theme.ts`, `index.html`)

1. `reset.css`, `primitives.css`, `tokens.css`, `global.css`, fonts import,
   `index.html` pre-paint theme script, `theme.ts` (read/write, system sync).
2. `src/ui/`: `Button` (variants: primary/secondary/ghost/danger; sizes),
   `Dialog` + `AlertDialog`, `Popover`, `Tooltip`, `Toast` (provider +
   `useToast`), `Select`, `Toggle`/`ToggleGroup`, `Field` (label, error,
   description), `Textarea` (native, styled), `Spinner`, `EmptyState`.
   Each wraps Base UI with a `.module.css`, styled via `data-*` states,
   using semantic tokens only.
3. `/` gets a temporary kitchen-sink section (removed in M4) so the
   verifier can eyeball components; e2e `theme.spec.ts`.
Acceptance: components render in light and dark; keyboard nav works for
Dialog/Popover/Select; no hard-coded colors outside `tokens.css`.

### M2 — Data layer `[~]`  (parallel-safe: `src/db`, `src/lib`, `src/app/debug.ts`)

1. `db.ts` Dexie schema v1 + `meta` bootstrap (`deviceId`, `schemaVersion`).
2. `repo.ts` write path; `settings.ts` typed getters/setters with defaults +
   `useSetting` hook (`useLiveQuery`).
3. `snapshot.ts` export / import / `mergeSnapshot` with unit tests.
4. `debug.ts` exposes `window.__thai`.
5. Tombstone purge on startup.
Acceptance: unit tests green; a scratch page or vitest with `fake-indexeddb`
proves create → list → soft delete → export → import-merge round trip.

### M3 — LLM layer `[~]`  (parallel-safe: `src/llm`, `src/fixtures`, `scripts/gen-fixture.ts`, `e2e/mocks`)

1. `split.ts` + tests. `schema.ts` + invariant checker + tests.
2. `prompt.ts` (system prompt per §4.2; `PROMPT_VERSION = 1`).
3. `client.ts`, `annotateLine.ts`, `pipeline.ts` (queue, abort, resume,
   usage accounting). The pipeline takes repo functions as parameters so it
   is testable without React.
4. `scripts/gen-fixture.ts` (`pnpm tsx scripts/gen-fixture.ts`, real key,
   Node — no `dangerouslyAllowBrowser`). Run it once; review the output for
   quality (romanization convention followed? notes useful? invariants
   hold?) and iterate on the prompt up to 3 times, then commit the fixture.
5. `e2e/mocks/anthropic.ts` SSE builder + handler; unit test it through the
   real SDK with a stubbed global `fetch`.
Acceptance: unit tests green; fixture committed; a Node smoke run of
`pipeline` against the mock completes with `status: 'complete'`.

### M4 — Pages and flows `[ ]`  (serial after M1–M3; can split Home/Library vs DialogueView vs Settings across agents once the shared hooks land)

1. `useAnnotate` (TanStack `useMutation` around `pipeline`, progress state,
   cancel, retry-failed, resume-on-open when a `partial` record exists).
2. Home: Composer + Library (remove kitchen sink).
3. DialogueView: LineView, WordChip, WordPopover, SyllableRow, ToneBadge,
   AnnotateStatus, rename, delete, re-annotate, per-dialogue export.
4. Settings page + export/import UI.
5. Not-found route; empty states; toasts on errors.
6. e2e: `annotate`, `word-popover`, `library`, `persistence`, `errors`,
   `settings`. Keep total suite < 60 s (measure; shard-friendly).
Acceptance: all specs green locally and on Vercel; manual walk with a real
key on the preview URL (Tyler or executor via `playwright-cli` with the
mock disabled) annotates a real dialogue end-to-end.

### M5 — Hardening and handoff `[ ]`

1. Accessibility pass (labels, focus rings, `aria-live` on progress).
2. Performance: library list stays cheap with 100 dialogues (annotations in
   a separate table); Lighthouse-style sanity on the preview URL.
3. `README.md` (what/why/how to run/test/deploy; env vars; bypass secret).
4. `CLAUDE.md` + rules accuracy pass: every command and path claim must be
   true right now (prior-art lesson: "a false claim is worse than a missing
   one"). Update `PLAN.MD` status markers; add a "Next" list (Blob sync,
   server-side call, IPA, summary, audio).
5. Final `pnpm test:e2e:vercel` green; commit; push. Report the preview URL.

---

## 6. Context engineering (created in M0, kept accurate throughout)

### 6.1 `CLAUDE.md` (target < 80 lines)

Sections: one-paragraph purpose; stack line; **commands** (`pnpm dev`,
`check`, `test`, `test:e2e`, `test:e2e:vercel`, `deploy:preview`); layout
(one line per top-level dir); **hard rules** (10 max, e.g. "IndexedDB via
`src/db/repo.ts` is the only write path", "never call the real Anthropic
API from tests", "never `vercel --prod`", "no semicolons / single quotes /
Prettier decides", "no `enum`; `import type`", "semantic tokens only",
"commit + push after every green milestone", "don't merge `main`");
pointer table to `.claude/rules/*` and when each loads; link to `PLAN.MD`.
No directory dumps, no library tutorials (those live in rules).

### 6.2 `.claude/rules/*.md` (path-scoped; ~40–100 lines each)

| File | `paths` | Contents |
|---|---|---|
| `ui.md` | `src/ui/**`, `src/features/**`, `src/styles/**`, `src/routes/**` | Base UI wrapper pattern (`render`, `data-*`), token names, Thai typography rules (`lang`, line-height, keep-all), tone color map, empty/error state conventions, router file conventions |
| `data.md` | `src/db/**`, `src/lib/**` | Dexie schema + migration rule (bump version, write `.upgrade`), sync-readiness invariants (UUID, ISO timestamps, tombstones, `updatedAt` on every write), snapshot format, repo-only writes |
| `llm.md` | `src/llm/**`, `scripts/gen-fixture.ts`, `src/fixtures/**` | Model IDs, browser client rules, structured-output schema constraints, prompt-caching layout (stable system → dialogue → target), `PROMPT_VERSION` bump rule + regenerate fixture, error mapping, "no `thinking`/`temperature` params" |
| `testing.md` | `e2e/**`, `**/*.test.ts`, `playwright.config.ts`, `vitest.config.ts` | Fixture usage, mock handler contract, seeding via `window.__thai`, speed budget (< 60 s), `test.fixme` over weakened assertions, running against Vercel |
| `deploy.md` | `vercel.json`, `scripts/**`, `.env*` | Preview-only policy, env var names, bypass secret lives in `.env.local` and is verified via `vercel api` (not `vercel env pull`, which omits it), how to get a deployment URL, never `--prod` |

### 6.3 `.claude/agents/`

- `implementer.md` — `model: sonnet`. Receives a self-contained brief
  (goal, files to touch, files not to touch, acceptance checks, commands to
  run). Implements, runs `pnpm check && pnpm test` (+ named e2e spec),
  reports a ≤ 15-line summary: what changed, what was verified, anything
  unexpected. Never commits, never pushes.
- `verifier.md` — `model: sonnet`, read-mostly. Receives the brief + diff
  (never the implementer's reasoning). Runs the checks, reviews against
  acceptance criteria and the relevant rule file, reports PASS/FAIL with
  file:line evidence. Any stale claim in `CLAUDE.md`/rules is a FAIL.
- Optional `researcher.md` — `model: sonnet`, WebSearch/WebFetch only, for
  "verify current API of X before we use it" tasks.

### 6.4 `.claude/settings.json`

```json
{
  "permissions": {
    "allow": [
      "Bash(pnpm *)", "Bash(npx *)", "Bash(git status*)", "Bash(git diff*)",
      "Bash(git log*)", "Bash(git add *)", "Bash(git commit *)",
      "Bash(git push*)", "Bash(vercel *)", "Bash(vc *)",
      "WebFetch", "WebSearch"
    ],
    "deny": ["Read(./.env.local)", "Bash(vercel --prod*)", "Bash(vercel deploy --prod*)"]
  }
}
```

---

## 7. Execution protocol (for the orchestrating Opus session)

1. Read `PLAN.MD` fully; then `CLAUDE.md` once it exists. Do not re-research
   anything already pinned here unless an install or doc fetch contradicts it.
2. **M0 is serial** and done by one implementer (or the orchestrator
   itself for the git/vercel steps that need Tyler's credentials).
3. **M1, M2, M3 run in parallel** as three implementer agents with
   `isolation: worktree` (disjoint directories; all deps already installed
   in M0 so `package.json` does not change). Orchestrator merges each
   worktree branch into `vercel` after its verifier PASS, runs the full
   suite, commits, pushes.
4. **Brief template** for every delegated task:
   ```
   Task: <one line>
   Context: read CLAUDE.md, .claude/rules/<x>.md, PLAN.MD §<n>
   Files you own: <list>      Files you must not touch: <list>
   Do: <numbered steps>
   Acceptance: <observable checks incl. exact commands>
   Report: ≤15 lines — changed files, commands run + results, open questions
   ```
5. **Verification loop**: implementer → verifier → (FAIL → implementer with
   the verifier's findings, max 2 rounds → orchestrator intervenes).
6. **Commit + push** after every verified task (conventional-commit
   subject, body explains *why*; include the attribution trailers required
   by the session). Never wait for a milestone to end to commit.
7. **Deploy verification** at least at the end of M0, M4, M5 via
   `pnpm test:e2e:vercel`. Report the preview URL each time.
8. Keep orchestrator context small: never paste full file contents or test
   logs into your own context; have agents summarize. Use `/compact` with
   "keep decisions + open bugs" when context passes ~60%.
9. Real-API usage is limited to `scripts/gen-fixture.ts` (a handful of
   runs) and the final manual walk. Everything else is mocked.
10. When blocked on something only Tyler can do (bypass secret, dashboard
    settings), finish all unblocked work first, then ask once with the
    exact steps.

---

## 8. Prerequisites for Tyler (before or early in the executor session)

1. ~~Generate the Protection Bypass for Automation secret~~ **Done
   2026-09-12** and verified against the project. It lives only in
   `.env.local` (gitignored); if that file is lost, regenerate in the
   dashboard and paste it back as `VERCEL_AUTOMATION_BYPASS_SECRET=`.
2. Keep `ANTHROPIC_API_KEY` exported in the shell that runs the executor
   session (it is today). The executor will copy it into the Vercel
   *preview* environment.
3. Optional: `bun i -g vercel` to move the CLI from 56.4.1 to 59.16.0.
4. Confirm you are fine with ~$1–3 of Opus usage for fixture generation and
   the final manual walk.

---

## 9. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Opus latency per line still feels slow | Progressive render + persisted partials; Settings → Sonnet 5; later: `output_config.effort: 'medium'` knob |
| Structured-output schema rejected (constraint drift) | `zodOutputFormat` strips unsupported constraints; keep schema flat; fixture script surfaces errors early in M3 |
| SSE mock diverges from real SDK parsing | Unit test the mock through the real SDK with stubbed `fetch` (M3.5) |
| API key visible in preview bundle | Preview URLs are SSO-protected; never `--prod`; Settings override lets the embedded key be removed later; server-side move is a planned follow-up |
| `vite-css-modules` or router plugin friction with Vite 8 | Both optional/replaceable; drop typed CSS modules if it costs > 30 min |
| e2e suite creeps past 60 s | Chromium only, seed via `window.__thai` instead of UI, one `webServer`, no `waitForTimeout`; measure in M4 |
| Thai segmentation quality varies | Invariant checker + `warnings[]` shown subtly; `Intl.Segmenter('th')` available in `src/lib/thai.ts` as a non-LLM fallback for highlighting |
| Context files drift from reality | Verifier FAILs stale claims; M5 accuracy pass |

---

## 10. Reference snippets (verified shapes)

**vite.config.ts**
```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { tanstackRouter } from '@tanstack/router-plugin/vite'

export default defineConfig({
  plugins: [tanstackRouter({ target: 'react', autoCodeSplitting: true }), react()],
  envPrefix: ['VITE_', 'ANTHROPIC_API_KEY'],
  css: { modules: { localsConvention: 'camelCaseOnly' } },
})
```

**main.tsx (router + query)**
```tsx
const queryClient = new QueryClient()
const router = createRouter({ routeTree, context: { queryClient }, defaultPreload: 'intent' })
declare module '@tanstack/react-router' { interface Register { router: typeof router } }
// __root.tsx: createRootRouteWithContext<{ queryClient: QueryClient }>()({ component: Shell })
```

**playwright.config.ts**
```ts
import { defineConfig, devices } from '@playwright/test'
const remote = process.env.PLAYWRIGHT_BASE_URL
const baseURL = remote ?? 'http://localhost:4173'
export default defineConfig({
  testDir: 'e2e', fullyParallel: true, retries: remote ? 1 : 0,
  reporter: 'list', timeout: 15_000,
  use: {
    baseURL, trace: 'on-first-retry',
    extraHTTPHeaders: remote && process.env.VERCEL_AUTOMATION_BYPASS_SECRET ? {
      'x-vercel-protection-bypass': process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
      'x-vercel-set-bypass-cookie': 'true',
    } : {},
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: remote ? undefined : {
    command: 'pnpm build && pnpm preview --port 4173 --strictPort',
    url: baseURL, reuseExistingServer: true, timeout: 60_000,
  },
})
```

**Anthropic mock (e2e/mocks/anthropic.ts)**
```ts
export function sseFromText(text: string, model = 'claude-opus-5'): string {
  const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`
  const chunks = text.match(/[\s\S]{1,400}/g) ?? ['']
  return [
    ev('message_start', { message: { id: 'msg_mock', type: 'message', role: 'assistant', model,
      content: [], stop_reason: null, stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 1 } } }),
    ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }),
    ...chunks.map((c) => ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: c } })),
    ev('content_block_stop', { index: 0 }),
    ev('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 50 } }),
    ev('message_stop', {}),
  ].join('')
}
// handler: const body = route.request().postDataJSON(); find the <target> text in
// body.messages[0].content; look up fixture line; route.fulfill({ status: 200,
// contentType: 'text/event-stream', body: sseFromText(JSON.stringify(line)) })
```

**Structured output call**
```ts
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
const stream = client.messages.stream({ /* §4.2 */ output_config: { format: zodOutputFormat(LineAnnotationSchema) } }, { signal })
const msg = await stream.finalMessage()      // msg.parsed_output is typed
if (msg.stop_reason === 'refusal') throw new AnnotateError('refused', msg.stop_details?.explanation)
```

**vercel.json**
```json
{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }
```

**scripts/e2e-vercel.sh**
```sh
#!/usr/bin/env sh
set -eu
set -a; [ -f .env.local ] && . ./.env.local; set +a
raw=$(vercel deploy --yes)            # preview only; never --prod
# CLI 56.x prints a JSON envelope on stdout when stdout is not a TTY
url=$(printf '%s\n' "$raw" | sed -n 's/.*"url"[[:space:]]*:[[:space:]]*"\(https:\/\/[^"]*\)".*/\1/p' | head -n 1)
[ -n "$url" ] || url=$(printf '%s\n' "$raw" | grep -o 'https://[^"[:space:]]*\.vercel\.app' | head -n 1)
echo "Preview: $url"
PLAYWRIGHT_BASE_URL="$url" pnpm exec playwright test "$@"
```

**Corrected 2026-09-12 during M0**: `vercel deploy --yes` on CLI 56.4.1 does
*not* print a bare URL to stdout when stdout is a pipe — it prints a JSON
envelope (`{"status":"ok","deployment":{"url":"https://…"}}`). The original
one-liner captured the whole blob and every remote test failed on `page.goto`.

**tokens.css skeleton** — see §4.4; Radix step contract: 1 app bg · 2 subtle
bg · 3–5 UI bg/hover/active · 6–8 borders · 9–10 solid/hover · 11 muted
text · 12 text.

---

## 11. Sources consulted (planning date)

- Base UI: https://base-ui.com/react/overview/quick-start · /handbook/styling · /handbook/composition
- TanStack Router (Vite, file-based, router context): https://tanstack.com/router/latest/docs/framework/react/installation/with-vite
- TanStack Query persistQueryClient (why not for app state): https://tanstack.com/query/latest/docs/framework/react/plugins/persistQueryClient
- TanStack DB status/collections: https://tanstack.com/db/latest/docs/overview
- TanStack Form: https://tanstack.com/form/latest/docs/framework/react/quick-start
- Anthropic TS SDK (browser flag, helpers/zod, streaming + structured outputs): https://github.com/anthropics/anthropic-sdk-typescript · https://platform.claude.com/docs/en/build-with-claude/structured-outputs
- Dexie useLiveQuery / versions: https://dexie.org/docs/dexie-react-hooks/useLiveQuery()
- Vercel Blob SDK (future sync): https://vercel.com/docs/vercel-blob/using-blob-sdk
- Playwright web server / mocking / fixtures: https://playwright.dev/docs/test-webserver · /docs/mock
- Vercel protection bypass: https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation
- Vercel CLI deploy/list/inspect: https://vercel.com/docs/cli/deploy
- Claude Code memory / rules / agents: https://code.claude.com/docs/en/memory · /sub-agents · /best-practices
- Radix Colors scale: https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale
- Thai tone rules: http://www.thai-language.com/ref/tone-rules · Paiboon convention: https://phuut.app/articles/en/pronunciation/thai-paiboon-romanization/
- Fonts: https://fonts.google.com/specimen/Sarabun · @fontsource/noto-sans-thai
