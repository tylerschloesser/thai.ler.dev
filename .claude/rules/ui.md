---
paths:
  - 'src/ui/**'
  - 'src/features/**'
  - 'src/styles/**'
  - 'src/routes/**'
---

# UI rules

## Base UI wrapper pattern

Every primitive in `src/ui/` wraps a Base UI component (`@base-ui/react`):

- Style via `data-*` state attributes (`data-open`, `data-checked`,
  `data-disabled`, ...) in the component's `.module.css`, not via JS
  conditionals.
- Use the `render` prop when a consumer needs to swap the rendered element
  (e.g. a `Button` rendered as a router `Link`).
- `#root` needs `isolation: isolate` (set in `reset.css`) so Base UI
  popups/portals stack correctly.
- There is no Base UI `Textarea` primitive — `src/ui/Textarea` wraps a
  native `<textarea>`, styled with tokens. Unlike Base UI's own input
  components (`Select`, `Toggle`, ...), a plain `<textarea>` does **not**
  auto-register with a surrounding `Field.Root`: `Field.Label`'s `htmlFor`
  only resolves to a control that went through `Field.Control` (or one of
  the Field-aware Base UI components). Pair every `Field.Root` + `Textarea`
  with an explicit `useId()`, passed as `htmlFor` on `Field.Label` and `id`
  on `Textarea` — otherwise the field has a visible label but no accessible
  name (confirmed via the rendered a11y tree, not just reading the source).
- Kit (per docs/plans/P0.md §4.3): `Button`, `Dialog`/`AlertDialog`, `Popover`,
  `Tooltip`, `Toast` (provider + `useToast`), `Select`, `Toggle`/
  `ToggleGroup`, `Field`, `Textarea`, `Spinner`, `EmptyState`.

## Tokens

Reference semantic tokens from `src/styles/tokens.css` only — never a Radix
color variable (`--sand-9`, etc.) directly in component CSS. Families:
`--color-{bg,bg-subtle,surface,border,border-strong,fg,fg-muted,accent,
accent-hover,accent-fg,success,warning,danger,info}`, `--tone-{mid,low,
falling,high,rising}`, `--space-1..8`, `--radius-1..3`, `--text-0..5`,
`--font-sans`, `--font-thai`, `--shadow-1..2`, `--dur-1..2`, `--ease`.
`tokens.css` maps these with `light-dark(<light>, <dark>)`; theme override
is `[data-theme=light|dark]` on the root, set pre-paint from `index.html`.
There is no `primitives.css` — `tokens.css` transcribes the Radix hex
values directly (a comment on each var names the scale + step), because
Radix ships light/dark as separately scoped rulesets (`:root` vs `.dark`)
while `light-dark()` needs both values in one declaration, so the actual
Radix custom properties can never be referenced here anyway.

## Thai typography

Any element rendering Thai text: `lang="th"`, `font-family:
var(--font-thai)`, `line-height: 1.9`, `word-break: keep-all`. Word chips
use a larger base size (~1.25rem) than surrounding UI text.

## Tone color map (Okabe-Ito, colorblind-safe)

`mid #0072B2` · `low #009E73` · `falling #D55E00` · `high #E69F00` ·
`rising #CC79A7`. Store as `--tone-*` tokens; lighten ~12% lightness for
dark mode rather than reusing the light-mode hex.

## Empty / error states

Use the shared `EmptyState` component for "no dialogues yet"
(`DialogueList.tsx`); surface annotation and import/export errors through
the root `Toast` provider, not ad hoc inline banners. There is no
"no API key configured" state — the Anthropic key lives only in the
server's environment, never in Settings.

## Annotation status (`AnnotateStatus`, `src/features/annotate/`)

`AnnotateStatus` renders one of five states (`AnnotateState` in
`useAnnotate.ts`): `running`, `stalled`, `failed`, `cancelled`, `complete`.
The state + progress text sits in a single `<p aria-live="polite">` so a
screen reader announces a transition (e.g. `running` → `stalled`, or a poll
landing on `complete`) without the caller wiring up its own live region.
Cancel shows only in `running`; Retry shows in `failed`, `cancelled`, and
`stalled` (all three are "re-run the not-yet-successful lines" from the
user's point of view, even though only `failed` means the server considers
the job done).

## Sync section (`SyncStatus`, `src/features/settings/`)

Settings' "Sync" section is a labelled `<section aria-label="Sync">`
containing a `<dl>` status pair (last pull as relative time, pending
pushes), an inline error line when the last sync attempt failed, and two
actions: "Sync now" (manual `useSync().syncNow()`) and "Rebuild sync index"
(`POST /api/sync/manifest/rebuild` then a fresh pull) — maintenance for
when the manifest and the record blobs drift. Disable each button while its
own action is in flight (`isSyncing`/`isRebuilding`) rather than disabling
the whole section.

## Router file conventions

File-based routes live in `src/routes/` (TanStack Router,
`autoCodeSplitting`): `__root.tsx` (shell + `Outlet`), `index.tsx`,
`d.$id.tsx`, `settings.tsx`. `src/routeTree.gen.ts` is generated — commit it,
never hand-edit it.
