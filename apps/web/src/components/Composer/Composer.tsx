import { Field } from '@base-ui/react/field'
import { useState, type FormEvent } from 'react'
import { Button } from '../Button/Button.tsx'
import { createTranslation } from '../../db/actions.ts'
import styles from './Composer.module.css'

const SAMPLE = `A: สวัสดีครับ วันนี้เป็นยังไงบ้าง
B: ก็เรื่อยๆ ค่ะ เมื่อคืนนอนไม่ค่อยหลับ
A: เป็นอะไรหรือเปล่า`

export function Composer() {
  const [text, setText] = useState('')
  const trimmed = text.trim()

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!trimmed) return

    // Clears immediately because the write has already taken effect locally.
    // Nothing here waits on the server — offline, that wait would never end.
    createTranslation(trimmed)
    setText('')
  }

  return (
    <form className={styles.form} onSubmit={submit}>
      <Field.Root className={styles.field}>
        <Field.Label className={styles.label} htmlFor="composer">
          Thai text
        </Field.Label>
        <Field.Control
          id="composer"
          value={text}
          onChange={(event) => setText(event.target.value)}
          render={
            <textarea
              className={styles.textarea}
              rows={5}
              lang="th"
              placeholder="วางบทสนทนาภาษาไทยที่นี่…"
              spellCheck={false}
            />
          }
        />
      </Field.Root>

      <div className={styles.actions}>
        <Button type="submit" variant="solid" disabled={!trimmed}>
          Break it down
        </Button>
        <Button type="button" variant="quiet" onClick={() => setText(SAMPLE)}>
          Use an example
        </Button>
      </div>
    </form>
  )
}
