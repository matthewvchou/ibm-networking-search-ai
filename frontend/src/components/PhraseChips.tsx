import { useState } from 'react'
import type { FormEvent } from 'react'
import { Button, DismissibleTag, TextInput } from '@carbon/react'

// Matches the backend's TITLE_SUBSTRING_MIN_LENGTH: a shorter title search is rejected.
const MIN_PHRASE_LENGTH = 2
const COLLAPSED_COUNT = 8

interface PhraseChipsProps {
  phrases: string[]
  onChange: (phrases: string[]) => void
  // Offered only once the list differs from what the model proposed.
  canReset: boolean
  onReset: () => void
}

/** The job-title phrases being searched for, as chips the user can remove, add to or reset. */
export function PhraseChips({ phrases, onChange, canReset, onReset }: PhraseChipsProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [draft, setDraft] = useState('')

  const visible = isExpanded ? phrases : phrases.slice(0, COLLAPSED_COUNT)
  const canAdd = draft.trim().length >= MIN_PHRASE_LENGTH

  function handleAdd(e: FormEvent) {
    e.preventDefault()
    const phrase = draft.trim().replace(/\s+/g, ' ')
    if (!canAdd) return
    setDraft('')
    // Already there, ignoring case: nothing to add, and no reason to search it twice.
    if (phrases.some((existing) => existing.toLowerCase() === phrase.toLowerCase())) return
    setIsExpanded(true)
    onChange([...phrases, phrase])
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {visible.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center' }}>
          {visible.map((phrase) => (
            <DismissibleTag
              key={phrase}
              type="blue"
              text={phrase}
              dismissTooltipLabel={`Remove ${phrase}`}
              onClose={() => onChange(phrases.filter((existing) => existing !== phrase))}
            />
          ))}
          {phrases.length > COLLAPSED_COUNT && (
            <Button kind="ghost" size="sm" onClick={() => setIsExpanded((previous) => !previous)}>
              {isExpanded ? 'Show fewer' : `Show all ${phrases.length}`}
            </Button>
          )}
        </div>
      )}
      <form onSubmit={handleAdd} style={{ display: 'flex', alignItems: 'flex-end', gap: 8, maxWidth: 520 }}>
        <div style={{ flex: 1 }}>
          <TextInput
            id="suggestion-phrase"
            size="sm"
            labelText="Add a job title to search for"
            hideLabel
            placeholder="Add a job title to search for"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
        </div>
        <Button type="submit" size="sm" kind="secondary" disabled={!canAdd}>
          Add
        </Button>
        {canReset && (
          <Button kind="ghost" size="sm" onClick={onReset}>
            Reset to suggestions
          </Button>
        )}
      </form>
    </div>
  )
}
