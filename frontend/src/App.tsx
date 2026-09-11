import { useEffect, useRef, useState } from 'react'
import type { Employee, OrgNode } from './api/client'
import { getEmployee, getManagerChain, getOrgChart, searchEmployees } from './api/client'
import { OrgChart } from './components/OrgChart'

const SEARCH_DEBOUNCE_MS = 300
const MIN_QUERY_LENGTH = 3

function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    if (err.message === 'not-found') return 'Employee not found.'
    if (err.message === 'unavailable') return 'Directory service unavailable.'
    return err.message
  }
  return 'Something went wrong.'
}

function EmployeeRow({ employee, onSelect }: { employee: Employee; onSelect: (id: string) => void }) {
  return (
    <li>
      <button onClick={() => onSelect(employee.id)}>
        {employee.display_name} — {employee.title ?? 'no title'} ({employee.id})
      </button>
    </li>
  )
}

function App() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Employee[]>([])
  const [truncated, setTruncated] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [searchLoading, setSearchLoading] = useState(false)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [employee, setEmployee] = useState<Employee | null>(null)
  const [managerChain, setManagerChain] = useState<Employee[]>([])
  const [orgChart, setOrgChart] = useState<OrgNode | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)

  const abortRef = useRef<AbortController | null>(null)
  const trimmedQuery = query.trim()
  const searchActive = trimmedQuery.length >= MIN_QUERY_LENGTH
  const showKeepTyping = trimmedQuery.length > 0 && !searchActive

  useEffect(() => {
    if (trimmedQuery.length < MIN_QUERY_LENGTH) {
      abortRef.current?.abort()
      return
    }

    const timeoutId = setTimeout(() => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      setSearchLoading(true)
      setSearchError(null)
      searchEmployees(trimmedQuery, controller.signal)
        .then((data) => {
          setResults(data.results)
          setTruncated(data.truncated)
        })
        .catch((err: unknown) => {
          if (err instanceof Error && err.name === 'AbortError') return
          setResults([])
          setTruncated(false)
          setSearchError(errorMessage(err))
        })
        .finally(() => {
          setSearchLoading(false)
        })
    }, SEARCH_DEBOUNCE_MS)

    return () => clearTimeout(timeoutId)
  }, [trimmedQuery])

  async function selectEmployee(id: string) {
    setSelectedId(id)
    setDetailLoading(true)
    setDetailError(null)
    setEmployee(null)
    setManagerChain([])
    setOrgChart(null)
    try {
      const [emp, chain, chart] = await Promise.all([
        getEmployee(id),
        getManagerChain(id),
        getOrgChart(id, 2),
      ])
      setEmployee(emp)
      setManagerChain(chain.chain)
      setOrgChart(chart)
    } catch (err) {
      setDetailError(errorMessage(err))
    } finally {
      setDetailLoading(false)
    }
  }

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: 24, fontFamily: 'sans-serif' }}>
      <h1>IBM Directory (test harness)</h1>

      <form onSubmit={(e) => e.preventDefault()} style={{ marginBottom: 16 }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder='Search by name (e.g. "Chou, Matthew" or last name only)…'
          style={{ padding: 8, width: 300 }}
        />
        {searchActive && searchLoading && <span style={{ marginLeft: 8, color: '#666' }}>Searching…</span>}
      </form>

      <p style={{ fontSize: 12, color: '#666' }}>
        A single word matches first or last name. For a specific person, use "Last, First" or "First Last".
      </p>

      {searchActive && searchError && <p style={{ color: 'crimson' }}>{searchError}</p>}
      {showKeepTyping && <p>Keep typing… (min {MIN_QUERY_LENGTH} characters)</p>}
      {searchActive && !searchError && results.length === 0 && (
        <p>
          No results.
          {!trimmedQuery.includes(' ') && !trimmedQuery.includes(',') && (
            <> Try a full name, e.g. "{trimmedQuery} Lastname" or "Lastname, {trimmedQuery}".</>
          )}
        </p>
      )}

      {searchActive && results.length > 0 && (
        <>
          {truncated && <p><em>Results truncated.</em></p>}
          <ul>
            {results.map((r) => (
              <EmployeeRow key={r.id} employee={r} onSelect={selectEmployee} />
            ))}
          </ul>
        </>
      )}

      <hr style={{ margin: '24px 0' }} />

      {selectedId && (
        <div>
          {detailLoading && <p>Loading…</p>}
          {detailError && <p style={{ color: 'crimson' }}>{detailError}</p>}

          {employee && (
            <>
              <h2>{employee.display_name}</h2>
              <p>
                {employee.title ?? 'no title'} · {employee.department ?? 'no dept'} ·{' '}
                {employee.location ?? 'no location'}
              </p>
              <p>{employee.email ?? 'no email'}</p>

              <h3>Org chart</h3>
              {orgChart && (
                <OrgChart
                  managerChain={managerChain}
                  orgNode={orgChart}
                  selectedId={employee.id}
                  onSelect={selectEmployee}
                />
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

export default App
