import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { Button } from '../ui/Button'
import { Dialog } from '../ui/Dialog'
import { AlertDialog } from '../ui/AlertDialog'
import { Popover } from '../ui/Popover'
import { Tooltip } from '../ui/Tooltip'
import { useToast } from '../ui/Toast'
import { Select } from '../ui/Select'
import { Toggle } from '../ui/Toggle'
import { ToggleGroup } from '../ui/ToggleGroup'
import { Field } from '../ui/Field'
import { Textarea } from '../ui/Textarea'
import { Spinner } from '../ui/Spinner'
import { EmptyState } from '../ui/EmptyState'
import { useTheme } from '../app/theme'
import type { Theme } from '../app/theme'

export const Route = createFileRoute('/')({
  component: Index,
})

function Index() {
  return (
    <div>
      <h1>thai.ler.dev</h1>
      <p>Paste a dialogue to get an annotated breakdown. Coming soon.</p>
      {/* TEMPORARY: removed in M4 - kitchen sink for the M1 design system /
          UI kit, so every component/variant can be eyeballed in both
          themes before the real pages land. */}
      <KitchenSink />
    </div>
  )
}

function KitchenSink() {
  const { theme, resolvedTheme, setTheme } = useTheme()
  const { add } = useToast()
  const [toggled, setToggled] = useState(false)
  const [display, setDisplay] = useState<string[]>(['romanization'])
  const [model, setModel] = useState('sonnet')

  return (
    <section
      style={{
        marginTop: 'var(--space-8)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-6)',
      }}
      aria-label="Kitchen sink (temporary)"
    >
      <hr />
      <h2>Kitchen sink (temporary, removed in M4)</h2>

      <div>
        <h3>Theme</h3>
        <p>
          Setting: <strong>{theme}</strong> - resolved:{' '}
          <strong>{resolvedTheme}</strong>
        </p>
        <ToggleGroup
          aria-label="Theme"
          value={[theme]}
          onValueChange={(value) => {
            const next = value[0] as Theme | undefined
            if (next) setTheme(next)
          }}
        >
          <Toggle value="system">System</Toggle>
          <Toggle value="light">Light</Toggle>
          <Toggle value="dark">Dark</Toggle>
        </ToggleGroup>
      </div>

      <div>
        <h3>Button</h3>
        <div
          style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}
        >
          <Button variant="primary" size="md">
            Primary
          </Button>
          <Button variant="secondary" size="md">
            Secondary
          </Button>
          <Button variant="ghost" size="md">
            Ghost
          </Button>
          <Button variant="danger" size="md">
            Danger
          </Button>
          <Button variant="primary" size="sm">
            Primary sm
          </Button>
          <Button variant="secondary" size="sm">
            Secondary sm
          </Button>
          <Button variant="ghost" size="sm">
            Ghost sm
          </Button>
          <Button variant="danger" size="sm">
            Danger sm
          </Button>
          <Button variant="primary" disabled>
            Disabled
          </Button>
        </div>
      </div>

      <div>
        <h3>Dialog</h3>
        <Dialog.Root>
          <Dialog.Trigger render={<Button variant="secondary" />}>
            Open dialog
          </Dialog.Trigger>
          <Dialog.Popup>
            <Dialog.Title>Rename dialogue</Dialog.Title>
            <Dialog.Description>
              Press Escape or click outside to close.
            </Dialog.Description>
            <Field.Root>
              <Field.Label>Title</Field.Label>
              <Textarea rows={2} defaultValue="Ordering coffee" />
            </Field.Root>
            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: 'var(--space-3)',
                marginTop: 'var(--space-4)',
              }}
            >
              <Dialog.Close render={<Button variant="ghost" />}>
                Cancel
              </Dialog.Close>
              <Dialog.Close render={<Button variant="primary" />}>
                Save
              </Dialog.Close>
            </div>
            <Dialog.IconClose />
          </Dialog.Popup>
        </Dialog.Root>
      </div>

      <div>
        <h3>AlertDialog</h3>
        <AlertDialog.Root>
          <AlertDialog.Trigger render={<Button variant="danger" />}>
            Delete dialogue
          </AlertDialog.Trigger>
          <AlertDialog.Popup>
            <AlertDialog.Title>Delete this dialogue?</AlertDialog.Title>
            <AlertDialog.Description>
              This cannot be undone.
            </AlertDialog.Description>
            <AlertDialog.Actions>
              <AlertDialog.Close render={<Button variant="ghost" />}>
                Cancel
              </AlertDialog.Close>
              <AlertDialog.Close
                render={<Button variant="danger" />}
                onClick={() => add({ title: 'Deleted', type: 'success' })}
              >
                Delete
              </AlertDialog.Close>
            </AlertDialog.Actions>
          </AlertDialog.Popup>
        </AlertDialog.Root>
      </div>

      <div>
        <h3>Popover</h3>
        <Popover.Root>
          <Popover.Trigger render={<Button variant="secondary" />}>
            Word details
          </Popover.Trigger>
          <Popover.Popup>
            <Popover.Title>สวัสดี</Popover.Title>
            <Popover.Description lang="th">
              sa-wat-dii - hello (mid tone)
            </Popover.Description>
            <Popover.IconClose />
          </Popover.Popup>
        </Popover.Root>
      </div>

      <div>
        <h3>Tooltip</h3>
        <Tooltip.Provider>
          <Tooltip.Root>
            <Tooltip.Trigger render={<Button variant="ghost" />}>
              Hover me
            </Tooltip.Trigger>
            <Tooltip.Popup>Re-annotate this line</Tooltip.Popup>
          </Tooltip.Root>
        </Tooltip.Provider>
      </div>

      <div>
        <h3>Toast</h3>
        <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
          <Button
            variant="secondary"
            onClick={() =>
              add({
                title: 'Saved',
                description: 'Export complete.',
                type: 'success',
              })
            }
          >
            Success toast
          </Button>
          <Button
            variant="secondary"
            onClick={() =>
              add({
                title: 'Request failed',
                description: 'Line 3 could not be annotated.',
                type: 'error',
              })
            }
          >
            Error toast
          </Button>
        </div>
      </div>

      <div>
        <h3>Select</h3>
        <Select.Root
          value={model}
          onValueChange={(value) => {
            if (value) setModel(value)
          }}
        >
          <Select.Trigger aria-label="Model">
            <Select.Value />
          </Select.Trigger>
          <Select.Popup>
            <Select.Item value="sonnet">Claude Sonnet</Select.Item>
            <Select.Item value="opus">Claude Opus</Select.Item>
            <Select.Item value="haiku">Claude Haiku</Select.Item>
          </Select.Popup>
        </Select.Root>
      </div>

      <div>
        <h3>Toggle / ToggleGroup</h3>
        <div
          style={{
            display: 'flex',
            gap: 'var(--space-4)',
            alignItems: 'center',
          }}
        >
          <Toggle
            aria-label="Show gloss"
            pressed={toggled}
            onPressedChange={setToggled}
          >
            Gloss {toggled ? 'on' : 'off'}
          </Toggle>
          <ToggleGroup
            aria-label="Display"
            value={display}
            onValueChange={setDisplay}
            multiple
          >
            <Toggle value="romanization">Romanization</Toggle>
            <Toggle value="gloss">Gloss</Toggle>
            <Toggle value="notes">Notes</Toggle>
          </ToggleGroup>
        </div>
      </div>

      <div>
        <h3>Field + Textarea</h3>
        <Field.Root style={{ maxWidth: '32rem' }}>
          <Field.Label>Dialogue</Field.Label>
          <Textarea placeholder="Paste a Thai dialogue..." rows={4} />
          <Field.Description>One line per turn.</Field.Description>
        </Field.Root>
      </div>

      <div>
        <h3>Spinner</h3>
        <div
          style={{
            display: 'flex',
            gap: 'var(--space-4)',
            alignItems: 'center',
          }}
        >
          <Spinner size="sm" />
          <Spinner size="md" />
          <Spinner size="lg" />
        </div>
      </div>

      <div>
        <h3>EmptyState</h3>
        <EmptyState
          title="No dialogues yet"
          description="Paste a dialogue above and run it through Claude to get started."
          action={<Button variant="primary">Load sample</Button>}
        />
      </div>
    </section>
  )
}
