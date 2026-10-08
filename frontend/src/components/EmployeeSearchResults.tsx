import { useState } from 'react'
import type { ReactNode } from 'react'
import { ClickableTile, InlineNotification, PaginationNav, SkeletonText, Tag } from '@carbon/react'
import { useNavigate } from 'react-router'
import type { Employee } from '../api/client'
import { AvatarCircle } from './AvatarCircle'

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
        {pageResults.map((employee) => {
          const place = [employee.city, employee.state, employee.country_code]
            .filter(Boolean)
            .join(', ')
          // The title is the only thing this line carries now - sector and place have
          // their own tags - so it is the empty state too, and only when there is
          // genuinely nothing else to show.
          let subtitle: ReactNode = employee.title ? highlight(employee.title, titleTerms) : null
          if (!employee.title && !employee.org_unit && !place) subtitle = 'No details available'
          return (
            <ClickableTile
              key={employee.id}
              onClick={() => navigate(`/employee/${employee.id}${backTo ? `?${backTo}` : ''}`)}
            >
              {/* height:100% so the row fills the stretched tile, which lets the avatar and
                  its text centre as a group in the card rather than against the text alone.
                  Cards are grid items, so their height is definite and the percentage
                  resolves - a card taller than its content centres instead of top-aligning. */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, height: '100%' }}>
                <AvatarCircle id={employee.id} name={employee.display_name} size={56} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-h)' }}>
                    {employee.display_name}
                  </div>
                  {/* One line, ellipsised: job titles run long ("Technical Sales Specialist -
                      Storage - Eastern Region") and wrapping them made cards ragged. The
                      text column's minWidth:0 is what lets this shrink inside the flex row. */}
                  {subtitle && (
                    <div
                      style={{
                        fontSize: 13,
                        color: 'var(--text)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {subtitle}
                    </div>
                  )}
                  {/* Sector, then place, one per line. Side by side only fitted when both
                      labels were short, so a long sector pushed the place onto a second row
                      on some cards and not others; stacking is the same shape on every card.
                      Sector is `org_unit`, never `department` - the latter
                      is a raw code ("BDO", "870361") that means nothing to a reader. The place
                      ends in the 2-letter country code, not the full name, because `co` is long
                      and inconsistent for the same country; filter(Boolean) keeps a state-less
                      record reading "Hursley, GB" rather than leaving an empty segment. */}
                  {(employee.org_unit || place) && (
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'flex-start',
                        gap: 4,
                        marginTop: 4,
                      }}
                    >
                      {/* Carbon caps a Tag at 208px and the compound sector values
                          ("Infrastructure, Technology Lifecycle Services") all sat pinned
                          there, dwarfing the place tags at 113-138px. 150 puts the two in
                          the same band; Carbon's own label ellipsis does the truncating. */}
                      {employee.org_unit && (
                        <Tag type="blue" size="sm" style={{ margin: 0, maxWidth: 150 }}>
                          {employee.org_unit}
                        </Tag>
                      )}
                      {place && (
                        <Tag type="cool-gray" size="sm" style={{ margin: 0 }}>
                          {place}
                        </Tag>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </ClickableTile>
          )
        })}
      </div>
      {pageCount > 1 && (
        <div style={{ marginTop: 16, display: 'flex', justifyContent: 'center' }}>
          <PaginationNav page={page} totalItems={pageCount} onChange={setPage} />
        </div>
      )}
    </div>
  )
}
