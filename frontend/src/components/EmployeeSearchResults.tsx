import { useState } from 'react'
import type { ReactNode } from 'react'
import { ClickableTile, InlineNotification, PaginationNav, SkeletonText, Tag } from '@carbon/react'
import { useNavigate } from 'react-router'
import type { Employee } from '../api/client'

const PAGE_SIZE = 10

interface EmployeeSearchResultsProps {
  query: string
  titleFilter: string
  // The page's full search string, re-emitted on links into a profile so the name
  // *and* the job-title filter survive the trip back.
  backTo: string
  loading: boolean
  error: string | null
  results: Employee[]
  truncated: boolean
  totalMatched: number
}

// Wraps each occurrence of a needle in <mark>. Purely cosmetic: the match already
// happened server-side, so if the needle isn't found by JS (case folding or
// whitespace could differ) the text is rendered unchanged rather than asserted on.
function highlight(text: string, needles: string[]): ReactNode {
  const terms = needles.map((n) => n.trim()).filter(Boolean)
  if (terms.length === 0) return text
  const haystack = text.toLowerCase()
  // Collect match ranges by scanning for each term, then merge overlaps. Done with
  // indexOf rather than a built regex so a term containing regex metacharacters
  // ("C++") needs no escaping and cannot change how the match is interpreted.
  const ranges: Array<[number, number]> = []
  for (const term of terms) {
    const needle = term.toLowerCase()
    for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + needle.length)) {
      ranges.push([at, at + needle.length])
    }
  }
  if (ranges.length === 0) return text
  ranges.sort((a, b) => a[0] - b[0])
  const merged: Array<[number, number]> = []
  for (const [from, to] of ranges) {
    const last = merged[merged.length - 1]
    if (last && from <= last[1]) last[1] = Math.max(last[1], to)
    else merged.push([from, to])
  }
  const out: ReactNode[] = []
  let cursor = 0
  merged.forEach(([from, to], i) => {
    if (from > cursor) out.push(text.slice(cursor, from))
    out.push(<mark key={i}>{text.slice(from, to)}</mark>)
    cursor = to
  })
  if (cursor < text.length) out.push(text.slice(cursor))
  return out
}

export function EmployeeSearchResults({
  query,
  titleFilter,
  backTo,
  loading,
  error,
  results,
  truncated,
  totalMatched,
}: EmployeeSearchResultsProps) {
  const navigate = useNavigate()
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
      {truncated && (
        <InlineNotification
          kind="info"
          title={`Showing ${results.length} of ${totalMatched.toLocaleString()} matches`}
          subtitle="Refine your search for more specific results."
          hideCloseButton
          lowContrast
          style={{ marginBottom: 16 }}
        />
      )}
      {titleTerms.length > 0 && (
        <p style={{ fontSize: 12, marginBottom: 12 }}>
          Only about a quarter of employees have a job title recorded, so this search cannot see the rest.
        </p>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {pageResults.map((employee) => (
          <ClickableTile
            key={employee.id}
            onClick={() => navigate(`/employee/${employee.id}${backTo ? `?${backTo}` : ''}`)}
          >
            <div style={{ fontWeight: 600 }}>{employee.display_name}</div>
            <div style={{ fontSize: 14 }}>
              {employee.title || employee.department ? (
                <>
                  {employee.title && highlight(employee.title, titleTerms)}
                  {employee.title && employee.department && ' · '}
                  {employee.department}
                </>
              ) : (
                'No details available'
              )}
            </div>
            {(employee.city || employee.location) && (
              <Tag type="cool-gray" style={{ marginTop: 4, marginLeft: 0 }}>
                {[employee.city, employee.state, employee.location].filter(Boolean).join(', ')}
              </Tag>
            )}
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
