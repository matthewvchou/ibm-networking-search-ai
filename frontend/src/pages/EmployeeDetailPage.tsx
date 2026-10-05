import { useEffect, useState } from 'react'
import { InlineNotification, SkeletonText } from '@carbon/react'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import { getDirectReports, getEmployee, getManagerChain, getOrgChart } from '../api/client'
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
  // The employee and everyone reporting to the same manager. Fetched after the
  // manager chain, since the manager's id comes out of it.
  const [peers, setPeers] = useState<Employee[]>([])
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
    setPeers([])
    // Depth 1, not 2: the chart draws direct reports and leaves their reports behind a
    // chevron, the same rule it applies to peers. One level less also removes a whole
    // generation of Bluepages calls from every profile load.
    Promise.all([getEmployee(id), getManagerChain(id), getOrgChart(id, 1)])
      .then(([emp, chain, chart]) => {
        if (cancelled) return
        setEmployee(emp)
        setManagerChain(chain.chain)
        setOrgChart(chart)
        // The chain is self -> manager -> ... , so [1] is the direct manager. A
        // failed peer lookup is swallowed: it only costs the peer row, and failing
        // the whole page over it would be worse than the chart it had before.
        const managerId = chain.chain[1]?.id
        if (!managerId) return
        getDirectReports(managerId)
          .then((res) => {
            if (!cancelled) setPeers(res.reports)
          })
          .catch(() => undefined)
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
      <div style={{ flex: '1 1 380px', minWidth: 0, maxWidth: 560 }}>
        {loading && (
          <div style={{ marginTop: 16 }}>
            <SkeletonText paragraph lineCount={3} />
          </div>
        )}
        {error && <InlineNotification kind="error" title="Couldn't load employee" subtitle={error} hideCloseButton />}

        {employee && <EmployeeProfile employee={employee} manager={managerChain[1] ?? null} backTo={backTo} />}
      </div>

      {/* The chart gets the larger share: a full peer row is far wider than the profile
          card needs to be. Still flex-wrap, so a narrow viewport stacks. */}
      {orgChart && employee && (
        <div style={{ flex: '2 1 640px', minWidth: 0 }}>
          <OrgChart
            // Remount per employee, so expansions, the folded manager chain and the
            // viewport all reset rather than carrying over to a different person.
            key={employee.id}
            managerChain={managerChain}
            orgNode={orgChart}
            peers={peers}
            selfEmployee={employee}
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
