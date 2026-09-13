import { useEffect } from 'react'
import { useForm } from '@tanstack/react-form'
import type { Theme } from '../../app/theme'
import { useTheme } from '../../app/theme'
import { setSetting, useSetting } from '../../db/settings'
import { Field, Select, Toggle, ToggleGroup } from '../../ui'
import styles from './SettingsForm.module.css'

const MODEL_OPTIONS = [
  { value: 'claude-opus-5', label: 'Claude Opus 5' },
  { value: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
] as const

const THEME_OPTIONS: Array<{ value: Theme; label: string }> = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

const THAI_FONT_SCALE_MIN = 0.8
const THAI_FONT_SCALE_MAX = 1.6
const THAI_FONT_SCALE_STEP = 0.1

interface FormValues {
  model: string
  showRomanization: boolean
  showGloss: boolean
  toneColors: boolean
  thaiFontScale: number
}

/**
 * Settings apply immediately - every field persists to Dexie (via
 * `setSetting`, the only write path per .claude/rules/data.md) the moment
 * it changes, there is no separate Save step. TanStack Form is still used
 * for field wiring (docs/plans/P0.md §4.3); `defaultValues` only seeds the
 * form once, so the effect below re-syncs it whenever the underlying
 * setting changes from elsewhere (e.g. an Import merge on this same page).
 * `theme` is the one exception: it is not a Dexie setting at all - it's
 * wired straight through `src/app/theme.ts` (localStorage-backed) so this
 * control and the header's theme toggle in `__root.tsx` never drift apart.
 *
 * `model` is also what `POST /api/annotate` sends (PLAN.MD §4.5) - there is
 * no API-key field here anymore: the Anthropic key lives only in the
 * server's environment (M3 moved the call to `api/`).
 */
export function SettingsForm() {
  const model = useSetting('model')
  const showRomanization = useSetting('showRomanization')
  const showGloss = useSetting('showGloss')
  const toneColors = useSetting('toneColors')
  const thaiFontScale = useSetting('thaiFontScale')
  const { theme, setTheme } = useTheme()

  const liveValues: FormValues = {
    model,
    showRomanization,
    showGloss,
    toneColors,
    thaiFontScale,
  }

  const form = useForm({
    defaultValues: liveValues,
  })

  useEffect(() => {
    form.reset(liveValues)
    // Re-sync only when the persisted values themselves change - not on
    // every render (`liveValues` is a fresh object each time).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, showRomanization, showGloss, toneColors, thaiFontScale])

  return (
    <form className={styles.root} onSubmit={(event) => event.preventDefault()}>
      <p className={styles.applyNote}>
        Changes save immediately - there is nothing else to do.
      </p>

      <form.Field name="model">
        {(field) => (
          <Field.Root>
            <Field.Label>Model</Field.Label>
            <Select.Root
              items={MODEL_OPTIONS}
              value={field.state.value}
              onValueChange={(value) => {
                if (value === null) return
                field.handleChange(value)
                void setSetting('model', value)
              }}
            >
              <Select.Trigger>
                <Select.Value />
              </Select.Trigger>
              <Select.Popup>
                {MODEL_OPTIONS.map((option) => (
                  <Select.Item key={option.value} value={option.value}>
                    {option.label}
                  </Select.Item>
                ))}
              </Select.Popup>
            </Select.Root>
            <Field.Description>
              Used for new annotation runs, sent to `POST /api/annotate`. Opus 5
              is the default (slower, higher quality); Sonnet 5 is faster.
            </Field.Description>
          </Field.Root>
        )}
      </form.Field>

      <Field.Root>
        <Field.Label>Theme</Field.Label>
        <ToggleGroup
          aria-label="Theme"
          value={[theme]}
          onValueChange={(value) => {
            const next = value[0] as Theme | undefined
            if (next) setTheme(next)
          }}
        >
          {THEME_OPTIONS.map((option) => (
            <Toggle key={option.value} value={option.value}>
              {option.label}
            </Toggle>
          ))}
        </ToggleGroup>
      </Field.Root>

      <form.Field name="showRomanization">
        {(field) => (
          <Field.Root className={styles.toggleField}>
            <Toggle
              pressed={field.state.value}
              onPressedChange={(pressed) => {
                field.handleChange(pressed)
                void setSetting('showRomanization', pressed)
              }}
            >
              Show romanization
            </Toggle>
            <Field.Description>
              Show Paiboon-style romanization under each Thai word.
            </Field.Description>
          </Field.Root>
        )}
      </form.Field>

      <form.Field name="showGloss">
        {(field) => (
          <Field.Root className={styles.toggleField}>
            <Toggle
              pressed={field.state.value}
              onPressedChange={(pressed) => {
                field.handleChange(pressed)
                void setSetting('showGloss', pressed)
              }}
            >
              Show gloss
            </Toggle>
            <Field.Description>
              Show the English gloss under each Thai word.
            </Field.Description>
          </Field.Root>
        )}
      </form.Field>

      <form.Field name="toneColors">
        {(field) => (
          <Field.Root className={styles.toggleField}>
            <Toggle
              pressed={field.state.value}
              onPressedChange={(pressed) => {
                field.handleChange(pressed)
                void setSetting('toneColors', pressed)
              }}
            >
              Tone colors
            </Toggle>
            <Field.Description>
              Color syllables by tone (mid, low, falling, high, rising).
            </Field.Description>
          </Field.Root>
        )}
      </form.Field>

      <form.Field name="thaiFontScale">
        {(field) => (
          <Field.Root>
            <Field.Label>
              Thai text size ({field.state.value.toFixed(1)}x)
            </Field.Label>
            <input
              type="range"
              className={styles.range}
              min={THAI_FONT_SCALE_MIN}
              max={THAI_FONT_SCALE_MAX}
              step={THAI_FONT_SCALE_STEP}
              value={field.state.value}
              onChange={(event) => {
                const value = Number(event.target.value)
                field.handleChange(value)
                void setSetting('thaiFontScale', value)
              }}
              aria-label="Thai text size"
            />
            <Field.Description>
              Scales Thai word chips and syllable text in the dialogue view.
            </Field.Description>
          </Field.Root>
        )}
      </form.Field>
    </form>
  )
}
