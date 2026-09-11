import { ClickableTile, InlineNotification, SkeletonText } from '@carbon/react'
import { useNavigate } from 'react-router'
import type { Employee } from '../api/client'

interface EmployeeSearchResultsProps {
  query: string
  loading: boolean
  error: string | null
  results: Employee[]
  truncated: boolean
}

export function EmployeeSearchResults({ query, loading, error, results, truncated }: EmployeeSearchResultsProps) {
  const navigate = useNavigate()

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
        {results.map((employee) => (
          <ClickableTile key={employee.id} onClick={() => navigate(`/employee/${employee.id}`)}>
            <div style={{ fontWeight: 600 }}>{employee.display_name}</div>
            <div style={{ fontSize: 14 }}>
              {[employee.title, employee.department, employee.location].filter(Boolean).join(' · ') || 'No details available'}
            </div>
          </ClickableTile>
        ))}
      </div>
    </div>
  )
}
