import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { createDialogue } from '../../db/repo'
import { splitDialogue } from '../../llm/split'
import { startAnnotation } from '../annotate/useAnnotate'
import { Button, Field, Textarea, useToast } from '../../ui'
import sampleDialogueText from '../../fixtures/sample.dialogue.txt?raw'
import styles from './Composer.module.css'

/**
 * Paste-a-dialogue entry point (PLAN.MD §4.3). On submit: creates the
 * dialogue row, fires off the annotation pipeline (fire-and-forget - it
 * keeps running after this component navigates away), and navigates to
 * `/d/$id` immediately. Progress renders there via `AnnotateStatus`.
 */
export function Composer() {
  const navigate = useNavigate()
  const { add: addToast } = useToast()
  const [sourceText, setSourceText] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const lineCount = splitDialogue(sourceText).length
  const canSubmit = lineCount > 0 && !isSubmitting

  function loadSample() {
    setSourceText(sampleDialogueText.trim())
  }

  async function handleSubmit() {
    const trimmed = sourceText.trim()
    if (!trimmed || isSubmitting) return

    setIsSubmitting(true)
    try {
      const dialogue = await createDialogue(trimmed)
      startAnnotation(dialogue).catch((err: unknown) => {
        addToast({
          title: 'Could not start annotation',
          description: err instanceof Error ? err.message : 'Unknown error',
          type: 'error',
        })
      })
      await navigate({ to: '/d/$id', params: { id: dialogue.id } })
      setSourceText('')
    } catch (err) {
      addToast({
        title: 'Could not create the dialogue',
        description: err instanceof Error ? err.message : 'Unknown error',
        type: 'error',
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <section className={styles.root} aria-label="Compose a dialogue">
      <Field.Root>
        <Field.Label>Paste a Thai dialogue</Field.Label>
        <Textarea
          rows={8}
          value={sourceText}
          onChange={(event) => setSourceText(event.target.value)}
          placeholder={
            'พนักงาน: สวัสดีค่ะ รับอะไรดีคะ\nลูกค้า: ขอผัดไทยกุ้งสดหนึ่งจานครับ'
          }
          lang="th"
        />
        <Field.Description>
          One turn per line, optionally prefixed with "Speaker: ".
        </Field.Description>
      </Field.Root>

      <div className={styles.footer}>
        <div className={styles.footerLeft}>
          <Button variant="ghost" size="sm" onClick={loadSample} type="button">
            Load sample
          </Button>
          <span className={styles.lineCount}>
            {lineCount} {lineCount === 1 ? 'line' : 'lines'}
          </span>
        </div>
        <Button
          variant="primary"
          disabled={!canSubmit}
          onClick={() => void handleSubmit()}
        >
          {isSubmitting ? 'Starting…' : 'Annotate'}
        </Button>
      </div>
    </section>
  )
}
