import { Tile } from '@carbon/react'
import type { Employee } from '../api/client'

export function EmployeeProfile({ employee }: { employee: Employee }) {
  return (
    <Tile>
      <h2 style={{ margin: 0 }}>{employee.display_name}</h2>
      <p style={{ marginTop: 4 }}>
        {[employee.title, employee.department, employee.location].filter(Boolean).join(' · ') || 'No details available'}
      </p>
      <p style={{ marginTop: 4 }}>{employee.email ?? 'No email on file'}</p>
    </Tile>
  )
}
