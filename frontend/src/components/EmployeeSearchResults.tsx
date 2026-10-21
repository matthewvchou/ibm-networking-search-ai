import { useState } from 'react'
import { InlineNotification, PaginationNav, SkeletonText } from '@carbon/react'
import { useNavigate } from 'react-router'
import type { Employee } from '../api/client'
import { useIdentity } from '../identity/Identity'
import { EmployeeCard } from './EmployeeCard'

const PAGE_SIZE = 32

interface EmployeeSearchResultsProps {
  query: string
  titleFilter: string
  // The page's full search string, re-emitted on links into a profile so the name
  // *and* the job-title filter survive the trip back.
  backTo: string
  loading: boolean
  error: string | null
  results: Employee[]
}

export function EmployeeSearchResults({
  query,
  titleFilter,
  backTo,
  loading,
  error,
  results,
}: EmployeeSearchResultsProps) {
  const navigate = useNavigate()
  const { identity } = useIdentity()
  const [page, setPage] = useState(0)
  const [resultsForPage, setResultsForPage] = useState(results)

  if (results !== resultsForPage) {
    setResultsForPage(results)
    setPage(0)
  }

  const titleTerms = titleFilter.trim() ? titleFilter.trim().split(/\s+/) : []
  // Whether a search was actually run. Previously this was keyed off `query` alone,
  // which meant a title-only search with no hits rendered nothing at all.
  const hasCriteria = Boolean(query.trim() || titleFilter.trim())

  // Surname first, then the full name, so rows read alphabetically by last name.
  const sortedResults = [...results].sort(
    (a, b) => a.last_name.localeCompare(b.last_name) || a.display_name.localeCompare(b.display_name),
  )
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

  if (hasCriteria && results.length === 0) {
    // The "add a first name" hint only makes sense for a bare one-word name search.
    const nameOnly = query.trim() && !titleFilter.trim()
    let hint = ''
    if (nameOnly && !query.includes(' ') && !query.includes(',')) {
      hint = ` Try adding a first name, e.g. "${query} Firstname" or "${query}, Firstname".`
    } else if (titleFilter.trim()) {
      hint =
        ' Job titles are only recorded for about a quarter of employees, so try a shorter or different wording.'
    }
    return (
      <InlineNotification kind="info" title="No results." subtitle={hint} hideCloseButton style={{ marginTop: 16 }} />
    )
  }

  if (results.length === 0) return null

  return (
    <div style={{ marginTop: 16 }}>
      {titleTerms.length > 0 && (
        <p style={{ fontSize: 12, marginBottom: 12 }}>
          Only about a quarter of employees have a job title recorded, so this search cannot see the rest.
        </p>
      )}
      {/* auto-fill track sizing, so the column count falls out of the available width -
          4 on a full desktop down to 1 on a phone - with no media queries, which inline
          styles could not express anyway. Grid items stretch, so cards in a row match
          heights even when one person has no job title. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
        {pageResults.map((employee) => (
          <EmployeeCard
            key={employee.id}
            employee={employee}
            titleTerms={titleTerms}
            // Your own card opens your Profile page, not the plain detail page.
            onClick={() =>
              navigate(
                employee.id === identity?.id
                  ? '/profile'
                  : `/employee/${employee.id}${backTo ? `?${backTo}` : ''}`,
              )
            }
          />
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
