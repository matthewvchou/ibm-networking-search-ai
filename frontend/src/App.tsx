import { useState } from 'react'
import type { FormEvent } from 'react'
import type { Employee } from './api/client'
import { getDirectReports, getEmployee, getManagerChain, searchEmployees } from './api/client'

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

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [employee, setEmployee] = useState<Employee | null>(null)
  const [managerChain, setManagerChain] = useState<Employee[]>([])
  const [directReports, setDirectReports] = useState<Employee[]>([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)

  async function handleSearch(e: FormEvent) {
    e.preventDefault()
    setSearchError(null)
    if (!query.trim()) {
      setResults([])
      setTruncated(false)
      return
    }
    try {
      const data = await searchEmployees(query.trim())
      setResults(data.results)
      setTruncated(data.truncated)
    } catch (err) {
      setResults([])
      setTruncated(false)
      setSearchError(errorMessage(err))
    }
  }

  async function selectEmployee(id: string) {
    setSelectedId(id)
    setDetailLoading(true)
    setDetailError(null)
    setEmployee(null)
    setManagerChain([])
    setDirectReports([])
    try {
      const [emp, chain, reports] = await Promise.all([
        getEmployee(id),
        getManagerChain(id),
        getDirectReports(id),
      ])
      setEmployee(emp)
      setManagerChain(chain.chain)
      setDirectReports(reports.reports)
    } catch (err) {
      setDetailError(errorMessage(err))
    } finally {
      setDetailLoading(false)
    }
  }

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: 24, fontFamily: 'sans-serif' }}>
      <h1>IBM Directory (test harness)</h1>

      <form onSubmit={handleSearch} style={{ marginBottom: 16 }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name…"
          style={{ padding: 8, width: 300 }}
        />
        <button type="submit" style={{ padding: 8, marginLeft: 8 }}>
          Search
        </button>
      </form>

      {searchError && <p style={{ color: 'crimson' }}>{searchError}</p>}
      {!searchError && results.length === 0 && query && <p>No results.</p>}

      {results.length > 0 && (
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

              <h3>Manager chain</h3>
              <ul style={{ display: 'flex', gap: 8, listStyle: 'none', padding: 0, flexWrap: 'wrap' }}>
                {managerChain.map((m, i) => (
                  <li key={m.id}>
                    <button onClick={() => selectEmployee(m.id)}>{m.display_name}</button>
                    {i < managerChain.length - 1 ? ' →' : ''}
                  </li>
                ))}
              </ul>

              <h3>Direct reports ({directReports.length})</h3>
              <ul>
                {directReports.map((r) => (
                  <EmployeeRow key={r.id} employee={r} onSelect={selectEmployee} />
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  )
}

export default App
