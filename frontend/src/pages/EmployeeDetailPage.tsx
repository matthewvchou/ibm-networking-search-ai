import { useEffect, useState } from 'react'
import { InlineNotification, SkeletonText } from '@carbon/react'
import { useNavigate, useParams } from 'react-router'
import { getEmployee, getManagerChain, getOrgChart } from '../api/client'
import type { Employee, OrgNode } from '../api/client'
import { errorMessage } from '../api/errors'
import { EmployeeProfile } from '../components/EmployeeProfile'
import { OrgChart } from '../components/OrgChart'

export function EmployeeDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [employee, setEmployee] = useState<Employee | null>(null)
  const [managerChain, setManagerChain] = useState<Employee[]>([])
  const [orgChart, setOrgChart] = useState<OrgNode | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setEmployee(null)
    setManagerChain([])
    setOrgChart(null)
    Promise.all([getEmployee(id), getManagerChain(id), getOrgChart(id, 2)])
      .then(([emp, chain, chart]) => {
        if (cancelled) return
        setEmployee(emp)
        setManagerChain(chain.chain)
        setOrgChart(chart)
      })
      .catch((err) => {
        if (cancelled) return
        setError(errorMessage(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [id])

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: 24 }}>
      {loading && <SkeletonText paragraph lineCount={3} />}
      {error && <InlineNotification kind="error" title="Couldn't load employee" subtitle={error} hideCloseButton />}

      {employee && (
        <>
          <EmployeeProfile employee={employee} />

          <h3 style={{ marginTop: 24 }}>Org chart</h3>
          {orgChart && (
            <OrgChart
              managerChain={managerChain}
              orgNode={orgChart}
              selectedId={employee.id}
              onSelect={(selectedId) => navigate(`/employee/${selectedId}`)}
            />
          )}
        </>
      )}
    </div>
  )
}
