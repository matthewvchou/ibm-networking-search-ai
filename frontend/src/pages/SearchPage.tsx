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
      })
      .catch((err) => {
        if (cancelled) return
        setResults([])
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
    // 20px between the header and the search field. Carbon's .cds--content puts 32px of
    // padding above this and the 40px-tall Search sits 8px into its row (bottom-aligned
    // against the 48px button), so hitting 20 means pulling 20 back off the shell's
    // padding. Done here rather than on Content, which every page shares.
    <div style={{ maxWidth: 1200, margin: '-20px auto 0', padding: '0 24px 24px' }}>
      {/* The page is wide enough for a four-column result grid, but the inputs are not
          improved by being 1200px long - hence the cap on the form. It then sits 40px left
          of the grid's first column: the offset is on the form alone so the grid stays put.
          Safe at every width - the shell's 32px padding plus the wrapper's 24px leave 56px
          to borrow from, so even a 320px viewport keeps 16px of margin. */}
      <form
        onSubmit={handleSubmit}
        style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 700, marginLeft: -40 }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <Search
              id="employee-search"
              labelText="Search employees"
              placeholder="Search by name"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={!canSearch}>
            Search
          </Button>
        </div>
        {/* hideLabel rather than no label: the visible "Job title contains (optional)"
            caption is gone, but the field still needs an accessible name, and the
            placeholder alone is not one. */}
        <TextInput
          id="employee-search-title"
          labelText="Job title contains (optional)"
          hideLabel
          placeholder="Search by job title"
          helperText={
            <em>
              *Only about a quarter of employees have a job title recorded, so this will miss
              people.
            </em>
          }
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
      />
    </div>
  )
}
