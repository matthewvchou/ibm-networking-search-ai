import { useState } from 'react'
import type { FormEvent } from 'react'
import type { Employee, OrgNode } from './api/client'
import { getEmployee, getManagerChain, getOrgChart, searchEmployees } from './api/client'
import { OrgChart } from './components/OrgChart'

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
  const [orgChart, setOrgChart] = useState<OrgNode | null>(null)
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

      <form onSubmit={handleSearch} style={{ marginBottom: 16 }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder='Search by name (e.g. "Chou, Matthew" or last name only)…'
          style={{ padding: 8, width: 300 }}
        />
        <button type="submit" style={{ padding: 8, marginLeft: 8 }}>
          Search
        </button>
      </form>

      <p style={{ fontSize: 12, color: '#666' }}>
        A single word matches last name. For a specific person, use "Last, First" or "First Last".
      </p>

      {searchError && <p style={{ color: 'crimson' }}>{searchError}</p>}
      {!searchError && results.length === 0 && query && (
        <p>
          No results.
          {!query.trim().includes(' ') && !query.trim().includes(',') && (
            <> Try adding a first name, e.g. "{query.trim()} Firstname" or "{query.trim()}, Firstname".</>
          )}
        </p>
      )}

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
