import { Link, Tile } from '@carbon/react'
import { Link as RouterLink } from 'react-router'
import type { Employee } from '../api/client'
import { formatDisplayName } from '../utils/formatName'

interface EmployeeProfileProps {
  employee: Employee
  manager: Employee | null
  q?: string | null
}

export function EmployeeProfile({ employee, manager, q }: EmployeeProfileProps) {
  return (
    <Tile>
      <h2 style={{ margin: 0 }}>{formatDisplayName(employee.display_name)}</h2>
      <p style={{ marginTop: 4 }}>
        {[employee.title, employee.department, employee.org_unit, employee.location]
          .filter(Boolean)
          .join(' · ') || 'No details available'}
      </p>
      <p style={{ marginTop: 4 }}>{employee.email ?? 'No email on file'}</p>
      {employee.office_phone && (
        <p style={{ marginTop: 4 }}>Office: <a href={`tel:${employee.office_phone}`}>{employee.office_phone}</a></p>
      )}
      {employee.mobile_phone && (
        <p style={{ marginTop: 4 }}>Mobile: <a href={`tel:${employee.mobile_phone}`}>{employee.mobile_phone}</a></p>
      )}
      {employee.address && <p style={{ marginTop: 4 }}>{employee.address}</p>}
      {manager && (
        <p style={{ marginTop: 4 }}>
          Reports to:{' '}
          <Link as={RouterLink} to={`/employee/${manager.id}${q ? `?q=${encodeURIComponent(q)}` : ''}`}>
            {formatDisplayName(manager.display_name)}
          </Link>
        </p>
      )}
    </Tile>
  )
}
