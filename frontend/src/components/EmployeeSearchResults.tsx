import { useState } from 'react'
import { ClickableTile, InlineNotification, PaginationNav, SkeletonText } from '@carbon/react'
import { useNavigate } from 'react-router'
import type { Employee } from '../api/client'
import { formatDisplayName } from '../utils/formatName'

const PAGE_SIZE = 10

interface EmployeeSearchResultsProps {
  query: string
  loading: boolean
  error: string | null
  results: Employee[]
  truncated: boolean
}

export function EmployeeSearchResults({ query, loading, error, results, truncated }: EmployeeSearchResultsProps) {
  const navigate = useNavigate()
  const [page, setPage] = useState(0)
  const [resultsForPage, setResultsForPage] = useState(results)

  if (results !== resultsForPage) {
    setResultsForPage(results)
    setPage(0)
  }

  const sortedResults = [...results].sort((a, b) => a.display_name.localeCompare(b.display_name))
  const pageCount = Math.ceil(sortedResults.length / PAGE_SIZE)
  const pageResults = sortedResults.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)

  if (loading) {
    return (
      <div style={{ marginTop: 16 }}>
        <SkeletonText paragraph lineCount={3} />
      </div>
    )
  }

  if (error) {
    return (
      <InlineNotification kind="error" title="Search failed" subtitle={error} hideCloseButton style={{ marginTop: 16 }} />
    )
  }

  if (query && results.length === 0) {
    const hint = !query.includes(' ') && !query.includes(',')
      ? ` Try adding a first name, e.g. "${query} Firstname" or "${query}, Firstname".`
      : ''
    return (
      <InlineNotification kind="info" title="No results." subtitle={hint} hideCloseButton style={{ marginTop: 16 }} />
    )
  }

  if (results.length === 0) return null

  return (
    <div style={{ marginTop: 16 }}>
      {truncated && (
        <InlineNotification
          kind="info"
          title="Showing first results"
          subtitle="Refine your search for more specific results."
          hideCloseButton
          lowContrast
          style={{ marginBottom: 16 }}
        />
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {pageResults.map((employee) => (
          <ClickableTile
            key={employee.id}
            onClick={() =>
              navigate(`/employee/${employee.id}${query ? `?q=${encodeURIComponent(query)}` : ''}`)
            }
          >
            <div style={{ fontWeight: 600 }}>{formatDisplayName(employee.display_name)}</div>
            <div style={{ fontSize: 14 }}>
              {[employee.title, employee.department, employee.location].filter(Boolean).join(' · ') || 'No details available'}
            </div>
          </ClickableTile>
        ))}
      </div>
      {pageCount > 1 && (
        <div style={{ marginTop: 16, display: 'flex', justifyContent: 'center' }}>
          <PaginationNav page={page} totalItems={pageCount} onChange={setPage} />
        </div>
      )}
    </div>
  )
}
