import type { ReactNode } from 'react'
import { Button, Tag, Tile } from '@carbon/react'
import { Email, Enterprise, Launch, Location, Mobile, Phone, UserFollow } from '@carbon/icons-react'
import { Link as RouterLink } from 'react-router'
import type { Employee } from '../api/client'
import { formatDisplayName } from '../utils/formatName'

interface EmployeeProfileProps {
  employee: Employee
  manager: Employee | null
  q?: string | null
}

function DetailRow({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text)' }}>
      <span style={{ display: 'flex', flexShrink: 0, color: 'var(--cds-icon-secondary, #6f6f6f)' }}>{icon}</span>
      <span>{children}</span>
    </div>
  )
}

export function EmployeeProfile({ employee, manager, q }: EmployeeProfileProps) {
  const department = employee.department_name ?? employee.department

  const managerLink = manager && (
    <RouterLink to={`/employee/${manager.id}${q ? `?q=${encodeURIComponent(q)}` : ''}`}>
      {formatDisplayName(manager.display_name)}
    </RouterLink>
  )

  return (
    <Tile>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '2rem', fontWeight: 600, lineHeight: 1.25, color: 'var(--text-h)' }}>
            {formatDisplayName(employee.display_name)}
          </h2>

          {employee.title && (
            <p style={{ marginTop: 4, fontSize: 16, color: 'var(--text)' }}>{employee.title}</p>
          )}
        </div>

        <Button
          as="a"
          href={`https://w3.ibm.com/#/people/${employee.id}`}
          target="_blank"
          rel="noopener noreferrer"
          kind="tertiary"
          size="sm"
          renderIcon={Launch}
          style={{ flexShrink: 0 }}
        >
          W3 Page
        </Button>
      </div>

      {(department || employee.org_unit || employee.location || employee.employee_type) && (
        <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {department && <Tag type="blue">{department}</Tag>}
          {employee.org_unit && <Tag type="gray">{employee.org_unit}</Tag>}
          {employee.location && <Tag type="cool-gray">{employee.location}</Tag>}
          {employee.employee_type && <Tag type="teal">{employee.employee_type}</Tag>}
        </div>
      )}

      <div
        style={{
          marginTop: 16,
          paddingTop: 16,
          borderTop: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        <DetailRow icon={<Email size={16} />}>
          {employee.email ? <a href={`mailto:${employee.email}`}>{employee.email}</a> : 'No email on file'}
        </DetailRow>
        {employee.office_phone && (
          <DetailRow icon={<Phone size={16} />}>
            <a href={`tel:${employee.office_phone}`}>{employee.office_phone}</a> · Office
          </DetailRow>
        )}
        {employee.mobile_phone && (
          <DetailRow icon={<Mobile size={16} />}>
            <a href={`tel:${employee.mobile_phone}`}>{employee.mobile_phone}</a> · Mobile
          </DetailRow>
        )}
        {employee.company && <DetailRow icon={<Enterprise size={16} />}>{employee.company}</DetailRow>}
        {employee.address && <DetailRow icon={<Location size={16} />}>{employee.address}</DetailRow>}
        {managerLink && (
          <DetailRow icon={<UserFollow size={16} />}>
            Reports to {managerLink}
          </DetailRow>
        )}
      </div>
    </Tile>
  )
}
