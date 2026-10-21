import type { ReactNode } from 'react'
import { ClickableTile, Tag } from '@carbon/react'
import type { Employee } from '../api/client'
import { AvatarCircle } from './AvatarCircle'

interface EmployeeCardProps {
  employee: Employee
  // Words of the job-title filter to highlight in the title; empty when there is none.
  titleTerms?: string[]
  onClick: () => void
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

/** One person as a tile: avatar, name, job title, sector and place. Shared by every card grid and row. */
export function EmployeeCard({ employee, titleTerms = [], onClick }: EmployeeCardProps) {
  const place = [employee.city, employee.state, employee.country_code].filter(Boolean).join(', ')
  // The title is the only thing this line carries now - sector and place have
  // their own tags - so it is the empty state too, and only when there is
  // genuinely nothing else to show.
  let subtitle: ReactNode = employee.title ? highlight(employee.title, titleTerms) : null
  if (!employee.title && !employee.org_unit && !place) subtitle = 'No details available'

  const details = (
    // height:100% so the row fills the stretched tile, which lets the avatar and
    // its text centre as a group in the card rather than against the text alone.
    // Cards are grid items, so their height is definite and the percentage
    // resolves - a card taller than its content centres instead of top-aligning.
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, height: '100%' }}>
      <AvatarCircle id={employee.id} name={employee.display_name} size={56} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-h)' }}>{employee.display_name}</div>
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
  )

  return <ClickableTile onClick={onClick}>{details}</ClickableTile>
}
