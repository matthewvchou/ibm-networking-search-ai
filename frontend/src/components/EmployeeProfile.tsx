import { useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { Button, Tag, Tile } from '@carbon/react'
import { Email, Globe, Launch, Location, Mobile, Phone, UserFollow } from '@carbon/icons-react'
import { Link as RouterLink } from 'react-router'
import type { Employee } from '../api/client'
import { getPhotoUrl } from '../api/photos'

interface EmployeeProfileProps {
  employee: Employee
  manager: Employee | null
  // The originating search string, re-emitted so filters survive navigation.
  backTo?: string
  // Shows a "Not you?" button beside "W3 Page". Only the user's own /profile passes it:
  // it is the one place that forgets who this browser is.
  onNotYou?: () => void
}

const PHOTO_SIZE = 120

const MUTED = 'var(--cds-text-helper, #6f6f6f)'

const SECTION_TITLE: CSSProperties = {
  margin: 0,
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: '0.32px',
  textTransform: 'uppercase',
  color: MUTED,
}

// Shown whole rather than cropped to a circle - the source is already a square - and
// omitted entirely when the employee has no photo, rather than standing in a placeholder.
function ProfilePhoto({ employee }: { employee: Employee }) {
  const [failed, setFailed] = useState(false)
  if (failed) return null
  return (
    <img
      src={getPhotoUrl(employee.id, PHOTO_SIZE * 2)}
      alt={employee.display_name}
      width={PHOTO_SIZE}
      height={PHOTO_SIZE}
      onError={() => setFailed(true)}
      style={{ display: 'block', flexShrink: 0, width: PHOTO_SIZE, height: PHOTO_SIZE }}
    />
  )
}

// Google Maps' documented search-query form. `address` is deliberately postal
// with no building number in it - see _format_address_slaphapi in the backend.
function mapsUrl(address: string) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
}

// A caption plus its rows. The captions are what group the card: contact details, org
// facts and location used to sit in one undifferentiated list.
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ marginTop: 16 }}>
      <h3 style={SECTION_TITLE}>{title}</h3>
      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>{children}</div>
    </div>
  )
}

function DetailRow({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text)' }}>
      <span style={{ display: 'flex', flexShrink: 0, color: 'var(--cds-icon-secondary, #6f6f6f)' }}>{icon}</span>
      {/* A long email or a wrapped phone suffix would otherwise push past the tile edge,
          which the narrower two-fifths column makes easy to hit. */}
      <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{children}</span>
    </div>
  )
}

export function EmployeeProfile({ employee, manager, backTo, onNotYou }: EmployeeProfileProps) {
  const department = employee.department_name ?? employee.department

  // One location element, not two: "City, ST, CC" reads as the label, the office address
  // only lives in the link target and its hover title. Same three parts and the same join
  // as the search card, so a person's place reads identically in the grid and here. State
  // is legitimately absent for countries without one, so the filter leaves no empty
  // segment; falls back to the friendly country name only when all three are missing, and
  // to plain text when there is no address to point Maps at.
  const place =
    [employee.city, employee.state, employee.country_code].filter(Boolean).join(', ') ||
    employee.location
  const locationRow =
    place &&
    (employee.address ? (
      <a
        href={mapsUrl(employee.address)}
        target="_blank"
        rel="noopener noreferrer"
        title={[employee.building, employee.address].filter(Boolean).join(' · ')}
      >
        {place}
      </a>
    ) : (
      place
    ))

  const managerLink = manager && (
    <RouterLink to={`/employee/${manager.id}${backTo ? `?${backTo}` : ''}`}>
      {manager.display_name}
    </RouterLink>
  )

  return (
    <Tile>
      <div
        style={{
          display: 'flex',
          // The name, title and tags are centred against the photo as one block, so a
          // sparse record (no title, no tags) sits level with the photo's middle rather
          // than its top or bottom edge.
          alignItems: 'center',
          gap: 16,
          paddingBottom: 16,
          borderBottom: '1px solid var(--border)',
        }}
      >
        <ProfilePhoto employee={employee} />
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Held below 2rem: beside the 120px photo this column leaves roughly 190px for
              the name at its narrowest, where a 32px heading breaks across three lines. */}
          <h2 style={{ margin: 0, fontSize: '1.75rem', fontWeight: 600, lineHeight: 1.25, color: 'var(--text-h)' }}>
            {employee.display_name}
          </h2>

          {employee.title && (
            <p style={{ marginTop: 4, fontSize: 14, color: 'var(--text)' }}>{employee.title}</p>
          )}

          {/* Company and place belong to the identity, so they sit directly under the job
              title - one step down in size from it, and smaller icons to match. */}
          {(employee.company || locationRow) && (
            <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
              {employee.company && <DetailRow icon={<Globe size={14} />}>{employee.company}</DetailRow>}
              {locationRow && <DetailRow icon={<Location size={14} />}>{locationRow}</DetailRow>}
            </div>
          )}

          {/* Sector and department read as labels on the identity, so they sit with the
              name rather than in a list below. size="sm" with margin cleared matches the
              search card; Carbon's default tag margins fight the flex gap. */}
          {(employee.org_unit || department) && (
            <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {employee.org_unit && (
                <Tag type="blue" size="sm" className="profile-sector-tag" style={{ margin: 0 }}>
                  {employee.org_unit}
                </Tag>
              )}
              {department && (
                <Tag type="gray" size="sm" style={{ margin: 0 }}>{department}</Tag>
              )}
            </div>
          )}
        </div>
      </div>

      <Section title="Contact">
        <DetailRow icon={<Email size={16} />}>
          {employee.email ? <a href={`mailto:${employee.email}`}>{employee.email}</a> : 'No email on file'}
        </DetailRow>
        {employee.office_phone && (
          <DetailRow icon={<Phone size={16} />}>
            <a href={`tel:${employee.office_phone}`}>{employee.office_phone}</a>
            <span style={{ marginLeft: 8, color: MUTED }}>Office</span>
          </DetailRow>
        )}
        {employee.mobile_phone && (
          <DetailRow icon={<Mobile size={16} />}>
            <a href={`tel:${employee.mobile_phone}`}>{employee.mobile_phone}</a>
            <span style={{ marginLeft: 8, color: MUTED }}>Mobile</span>
          </DetailRow>
        )}
      </Section>

      {managerLink && (
        <div style={{ marginTop: 16 }}>
          <DetailRow icon={<UserFollow size={16} />}>
            Reports to {managerLink}
          </DetailRow>
        </div>
      )}

      <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
        <Button
          as="a"
          href={`https://w3.ibm.com/#/people/${employee.id}`}
          target="_blank"
          rel="noopener noreferrer"
          kind="tertiary"
          size="sm"
          renderIcon={Launch}
        >
          W3 Page
        </Button>
        {/* A button, not a link: it changes state rather than navigating. Clearing the
            identity brings the startup gate back. */}
        {onNotYou && (
          <Button kind="ghost" size="sm" onClick={onNotYou}>
            Not you?
          </Button>
        )}
      </div>
    </Tile>
  )
}
