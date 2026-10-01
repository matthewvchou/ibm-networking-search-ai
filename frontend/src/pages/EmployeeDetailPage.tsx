import { useEffect, useState } from 'react'
import { InlineNotification, SkeletonText } from '@carbon/react'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import { getEmployee, getManagerChain, getOrgChart } from '../api/client'
import type { Employee, OrgNode } from '../api/client'
import { errorMessage } from '../api/errors'
import { EmployeeProfile } from '../components/EmployeeProfile'
import { OrgChart } from '../components/OrgChart'

export function EmployeeDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  // The whole search string is carried through, not just ?q=, so a job-title filter
  // survives a trip into a profile and back.
  const backTo = searchParams.toString()

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
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'stretch',
        gap: 24,
        padding: 24,
        minHeight: 'calc(100vh - 48px)',
        boxSizing: 'border-box',
      }}
    >
      <div style={{ flex: '1 1 480px', minWidth: 0 }}>
        {loading && (
          <div style={{ marginTop: 16 }}>
            <SkeletonText paragraph lineCount={3} />
          </div>
        )}
        {error && <InlineNotification kind="error" title="Couldn't load employee" subtitle={error} hideCloseButton />}

        {employee && <EmployeeProfile employee={employee} manager={managerChain[1] ?? null} backTo={backTo} />}
      </div>

      {orgChart && employee && (
        <div style={{ flex: '1 1 480px', minWidth: 0 }}>
          <OrgChart
            managerChain={managerChain}
            orgNode={orgChart}
            selectedId={employee.id}
            onSelect={(selectedId) =>
              navigate(`/employee/${selectedId}${backTo ? `?${backTo}` : ''}`)
            }
          />
        </div>
      )}
    </div>
  )
}
