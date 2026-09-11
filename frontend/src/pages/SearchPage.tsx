import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Button, Search } from '@carbon/react'
import { useSearchParams } from 'react-router'
import { searchEmployees } from '../api/client'
import type { Employee } from '../api/client'
import { errorMessage } from '../api/errors'
import { EmployeeSearchResults } from '../components/EmployeeSearchResults'

export function SearchPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const query = searchParams.get('q') ?? ''
  const [inputValue, setInputValue] = useState(query)

  const [results, setResults] = useState<Employee[]>([])
  const [truncated, setTruncated] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setInputValue(query)
    if (!query) {
      setResults([])
      setTruncated(false)
      setError(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    searchEmployees(query)
      .then((data) => {
        if (cancelled) return
        setResults(data.results)
        setTruncated(data.truncated)
      })
      .catch((err) => {
        if (cancelled) return
        setResults([])
        setTruncated(false)
        setError(errorMessage(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [query])

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const trimmed = inputValue.trim()
    setSearchParams(trimmed ? { q: trimmed } : {})
  }

  return (
    <div style={{ maxWidth: 700, margin: '0 auto', padding: 24 }}>
      <form onSubmit={handleSubmit} style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <Search
            id="employee-search"
            labelText="Search employees"
            placeholder='Search by name (e.g. "Chou, Matthew" or last name only)…'
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
          />
        </div>
        <Button type="submit">Search</Button>
      </form>

      <EmployeeSearchResults query={query} loading={loading} error={error} results={results} truncated={truncated} />
    </div>
  )
}
