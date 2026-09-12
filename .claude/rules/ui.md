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
  native `<textarea>`, styled with tokens.
- Kit (per PLAN.MD §4.3, built in M1): `Button`, `Dialog`/`AlertDialog`,
  `Popover`, `Tooltip`, `Toast` (provider + `useToast`), `Select`,
  `Toggle`/`ToggleGroup`, `Field`, `Textarea`, `Spinner`, `EmptyState`.

## Tokens

Reference semantic tokens from `src/styles/tokens.css` only — never a Radix
color variable (`--sand-9`, etc.) directly in component CSS. Families:
`--color-{bg,bg-subtle,surface,border,border-strong,fg,fg-muted,accent,
accent-hover,accent-fg,success,warning,danger,info}`, `--tone-{mid,low,
falling,high,rising}`, `--space-1..8`, `--radius-1..3`, `--text-0..5`,
`--font-sans`, `--font-thai`, `--shadow-1..2`, `--dur-1..2`, `--ease`.
`tokens.css` maps these with `light-dark()`; theme override is
`[data-theme=light|dark]` on the root, set pre-paint from `index.html`.

## Thai typography

Any element rendering Thai text: `lang="th"`, `font-family:
var(--font-thai)`, `line-height: 1.9`, `word-break: keep-all`. Word chips
use a larger base size (~1.25rem) than surrounding UI text.

## Tone color map (Okabe-Ito, colorblind-safe)

`mid #0072B2` · `low #009E73` · `falling #D55E00` · `high #E69F00` ·
`rising #CC79A7`. Store as `--tone-*` tokens; lighten ~12% lightness for
dark mode rather than reusing the light-mode hex.

## Empty / error states

Use the shared `EmptyState` component for "no dialogues" / "no API key
configured"; surface pipeline and import/export errors through the root
`Toast` provider, not ad hoc inline banners.

## Router file conventions

File-based routes live in `src/routes/` (TanStack Router,
`autoCodeSplitting`): `__root.tsx` (shell + `Outlet`), `index.tsx`,
`d.$id.tsx`, `settings.tsx`. `src/routeTree.gen.ts` is generated — commit it,
never hand-edit it.
