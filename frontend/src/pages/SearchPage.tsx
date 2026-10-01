import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Button, Search, TextInput } from '@carbon/react'
import { useSearchParams } from 'react-router'
import { searchEmployees } from '../api/client'
import type { Employee } from '../api/client'
import { errorMessage } from '../api/errors'
import { EmployeeSearchResults } from '../components/EmployeeSearchResults'

export function SearchPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const query = searchParams.get('q') ?? ''
  const title = searchParams.get('title') ?? ''
  // Depend on the serialized params, never on `searchParams` itself: useSearchParams
  // hands back a new URLSearchParams identity every render, so using the object as a
  // dependency re-runs the effect forever.
  const paramsKey = searchParams.toString()

  const [inputValue, setInputValue] = useState(query)
  const [titleValue, setTitleValue] = useState(title)

  const [results, setResults] = useState<Employee[]>([])
  const [truncated, setTruncated] = useState(false)
  const [totalMatched, setTotalMatched] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(paramsKey)
    const q = params.get('q') ?? ''
    const t = params.get('title') ?? ''
    setInputValue(q)
    setTitleValue(t)
    if (!q && !t) {
      setResults([])
      setTruncated(false)
      setTotalMatched(0)
      setError(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    searchEmployees(q, { title: t })
      .then((data) => {
        if (cancelled) return
        setResults(data.results)
        setTruncated(data.truncated)
        setTotalMatched(data.total_matched)
      })
      .catch((err) => {
        if (cancelled) return
        setResults([])
        setTruncated(false)
        setTotalMatched(0)
        setError(errorMessage(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [paramsKey])

  // A search needs a name or a job title. There is deliberately no "everything"
  // search - the backend rejects one, because an unfiltered directory query does not
  // complete.
  const canSearch = Boolean(inputValue.trim() || titleValue.trim())

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!canSearch) return
    // Empty values are omitted so an existing ?q=-only link stays byte-identical.
    const next = new URLSearchParams()
    if (inputValue.trim()) next.set('q', inputValue.trim())
    if (titleValue.trim()) next.set('title', titleValue.trim())
    setSearchParams(next)
  }

  return (
    <div style={{ maxWidth: 700, margin: '0 auto', padding: 24 }}>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <Search
              id="employee-search"
              labelText="Search employees"
              placeholder='Search by name (e.g. "Chou, Matthew" or last name only)…'
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={!canSearch}>
            Search
          </Button>
        </div>
        <TextInput
          id="employee-search-title"
          labelText="Job title contains (optional)"
          placeholder='e.g. "architect", "site reliability"'
          helperText="Only about a quarter of employees have a job title recorded, so this will miss people."
          value={titleValue}
          onChange={(e) => setTitleValue(e.target.value)}
        />
      </form>

      <EmployeeSearchResults
        query={query}
        titleFilter={title}
        backTo={paramsKey}
        loading={loading}
        error={error}
        results={results}
        truncated={truncated}
        totalMatched={totalMatched}
      />
    </div>
  )
}
