import { useCallback, useEffect, useMemo, useState } from 'react'
import { InlineNotification, SkeletonText } from '@carbon/react'
import { useNavigate } from 'react-router'
import { getKeywordSuggestions, SummaryError } from '../api/client'
import type { KeywordSuggestions } from '../api/client'
import { useSuggestedPeople } from '../hooks/useSuggestedPeople'
import { clearSavedPhrases, readSavedPhrases, writeSavedPhrases } from '../utils/suggestionStorage'
import { PeopleRow } from './PeopleRow'
import { PhraseChips } from './PhraseChips'

interface SuggestionsSectionProps {
  employeeId: string
}

const SOURCE_NOTE: Record<KeywordSuggestions['source'], string> = {
  resume: 'Based on your resume.',
  title: 'Based on your job title, not a resume.',
  none: 'You have no resume or job title on file, so there is nothing to suggest from. Add job titles below to search for.',
}

/**
 * People worth reaching out to: the directory searched for job-title phrases that an AI
 * proposes from the user's resume, which the user can edit.
 */
export function SuggestionsSection({ employeeId }: SuggestionsSectionProps) {
  const navigate = useNavigate()
  // The user's edited list. Once there is one the model is not asked again, so their
  // edits are never overwritten behind their back; "Reset" is how they ask for a fresh list.
  const [savedPhrases, setSavedPhrases] = useState<string[] | null>(() => readSavedPhrases(employeeId))
  const [proposed, setProposed] = useState<KeywordSuggestions | null>(null)
  const [isLoading, setIsLoading] = useState(savedPhrases === null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    if (savedPhrases !== null) return
    const controller = new AbortController()
    setIsLoading(true)
    setErrorMessage(null)
    getKeywordSuggestions(employeeId, controller.signal)
      .then((result) => {
        setProposed(result)
        setIsLoading(false)
      })
      .catch((err) => {
        if (controller.signal.aborted) return
        // The chips box stays usable: hand-added phrases need no model.
        setErrorMessage(err instanceof SummaryError ? err.message : 'Could not load suggestions.')
        setIsLoading(false)
      })
    return () => controller.abort()
  }, [employeeId, savedPhrases])

  const phrases = useMemo(() => savedPhrases ?? proposed?.phrases ?? [], [savedPhrases, proposed])
  const { people, isSearching, hasAllFailed } = useSuggestedPeople(employeeId, phrases)

  const handleChange = useCallback(
    (next: string[]) => {
      setSavedPhrases(next)
      writeSavedPhrases(employeeId, next)
    },
    [employeeId],
  )

  function handleReset() {
    clearSavedPhrases(employeeId)
    setProposed(null)
    setSavedPhrases(null)
  }

  return (
    <section style={{ width: '100%', maxWidth: 1200, margin: '0 auto' }}>
      <h2 style={{ fontSize: 20, fontWeight: 400, color: 'var(--text-h)', marginBottom: 4 }}>
        People you might want to reach out to
      </h2>
      <p style={{ fontSize: 13, marginBottom: 12 }}>
        {proposed && savedPhrases === null ? SOURCE_NOTE[proposed.source] : 'Job titles to search for.'} Job titles
        are only recorded for about a quarter of employees, so this will miss people.
      </p>

      {isLoading && <SkeletonText paragraph lineCount={2} />}
      {errorMessage && (
        <InlineNotification
          kind="warning"
          title="Couldn't suggest job titles"
          subtitle={`${errorMessage} You can still add your own below.`}
          hideCloseButton
        />
      )}
      {!isLoading && (
        <PhraseChips
          phrases={phrases}
          onChange={handleChange}
          canReset={savedPhrases !== null}
          onReset={handleReset}
        />
      )}

      <div style={{ marginTop: 16 }}>
        {people.length > 0 && <PeopleRow people={people} onSelect={(id) => navigate(`/employee/${id}`)} />}
        {/* Only until the first cards arrive: later batches can take 30s+ each, and a bar
            under a row the user is already reading looks stuck. */}
        {isSearching && people.length === 0 && <SkeletonText paragraph lineCount={2} />}
        {hasAllFailed && (
          <InlineNotification
            kind="error"
            title="Search failed"
            subtitle="None of the job-title searches completed. Try again, or add narrower job titles."
            hideCloseButton
          />
        )}
        {!isLoading && !isSearching && !hasAllFailed && phrases.length > 0 && people.length === 0 && (
          <InlineNotification
            kind="info"
            title="No one found."
            subtitle=" None of these job titles matched anyone. Try different wording."
            hideCloseButton
          />
        )}
      </div>
    </section>
  )
}
