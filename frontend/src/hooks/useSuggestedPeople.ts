import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { searchEmployees } from '../api/client'
import type { Employee } from '../api/client'
import {
  appendBatch,
  MAX_PEOPLE_PER_PHRASE,
  MAX_ROW_PEOPLE,
  SEARCH_BATCH_SIZE,
} from '../utils/suggestionMerge'

interface SuggestedPeople {
  // In arrival order; a person already shown never moves.
  people: Employee[]
  isSearching: boolean
  // Every phrase's search failed, so an empty row means "couldn't look", not "no one".
  hasAllFailed: boolean
}

/**
 * Searches the directory for each job-title phrase and merges the people into one list.
 *
 * Phrases are searched SEARCH_BATCH_SIZE at a time. Each finished batch is interleaved and
 * appended, so the list only ever grows at the end while the user scrolls it. A phrase that
 * fails is skipped; each is searched once, so removing and re-adding a chip costs nothing.
 * Removing a chip takes that phrase's people (and only theirs) out of the list.
 */
export function useSuggestedPeople(selfId: string, phrases: string[]): SuggestedPeople {
  const [order, setOrder] = useState<string[]>([])
  const [peopleById, setPeopleById] = useState<Record<string, Employee>>({})
  const [idsByPhrase, setIdsByPhrase] = useState<Record<string, string[]>>({})
  const [failedPhrases, setFailedPhrases] = useState<string[]>([])
  const [isSearching, setIsSearching] = useState(false)

  const phrasesRef = useRef(phrases)
  const requestedRef = useRef(new Set<string>())
  const isRunningRef = useRef(false)
  const isUnmountedRef = useRef(false)

  // Reset on every mount, not just set on unmount: StrictMode runs mount, cleanup, mount.
  useEffect(() => {
    isUnmountedRef.current = false
    return () => {
      isUnmountedRef.current = true
    }
  }, [])

  const applyBatch = useCallback(
    (batch: string[], outcomes: (Employee[] | null)[]) => {
      const succeeded = outcomes.filter((people): people is Employee[] => people !== null)
      setOrder((previous) => appendBatch(previous, succeeded, selfId))
      setPeopleById((previous) => {
        const next = { ...previous }
        for (const person of succeeded.flat()) next[person.id] = person
        return next
      })
      setIdsByPhrase((previous) => {
        const next = { ...previous }
        batch.forEach((phrase, index) => {
          const people = outcomes[index]
          if (people) next[phrase] = people.map((person) => person.id)
        })
        return next
      })
      setFailedPhrases((previous) => [...previous, ...batch.filter((_, index) => outcomes[index] === null)])
    },
    [selfId],
  )

  useEffect(() => {
    phrasesRef.current = phrases
    if (isRunningRef.current) return
    isRunningRef.current = true
    setIsSearching(true)
    void runSearches()

    async function runSearches() {
      // Re-reads the latest phrases at every batch boundary, so chips added while a batch
      // is in flight are picked up by this same loop rather than a second one.
      for (;;) {
        const batch = phrasesRef.current
          .filter((phrase) => !requestedRef.current.has(phrase))
          .slice(0, SEARCH_BATCH_SIZE)
        if (batch.length === 0 || isUnmountedRef.current) {
          // Cleared in the same tick as the final check, not in a later `.finally`: a
          // phrase added in between would otherwise see the loop as running and never be searched.
          isRunningRef.current = false
          setIsSearching(false)
          return
        }
        batch.forEach((phrase) => requestedRef.current.add(phrase))
        const outcomes = await Promise.all(batch.map(searchPhrase))
        if (!isUnmountedRef.current) applyBatch(batch, outcomes)
      }
    }
  }, [phrases, applyBatch])

  const people = useMemo(() => {
    const activeIds = new Set(phrases.flatMap((phrase) => idsByPhrase[phrase] ?? []))
    return order
      .filter((id) => activeIds.has(id))
      .slice(0, MAX_ROW_PEOPLE)
      .map((id) => peopleById[id])
  }, [order, peopleById, idsByPhrase, phrases])

  const hasAllFailed = !isSearching && phrases.length > 0 && phrases.every((phrase) => failedPhrases.includes(phrase))

  return { people, isSearching, hasAllFailed }
}

// A failed search is null, not an error: one broad phrase timing out must not cost the
// others, and the row only reports a problem when every phrase failed.
async function searchPhrase(phrase: string): Promise<Employee[] | null> {
  try {
    const response = await searchEmployees('', { title: phrase, limit: MAX_PEOPLE_PER_PHRASE })
    return response.results.slice(0, MAX_PEOPLE_PER_PHRASE)
  } catch {
    return null
  }
}
