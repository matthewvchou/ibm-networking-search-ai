import { useEffect, useRef, useState } from 'react'
import { InlineNotification, SkeletonText } from '@carbon/react'
import { useNavigate } from 'react-router'
import { getDirectReports, getEmployee, getManagerChain, getOrgChart } from '../api/client'
import type { Employee, OrgNode } from '../api/client'
import { errorMessage } from '../api/errors'
import { EmployeeProfile } from './EmployeeProfile'
import { OrgChart } from './OrgChart'
import { ResumeSummaryPanel } from './ResumeSummaryPanel'

interface EmployeeDetailViewProps {
  id: string
  // The search string to carry through links into other profiles, so a job-title filter
  // survives a trip into a profile and back.
  backTo: string
  // Called when the directory has no such employee. /profile uses it to drop a saved
  // identity that no longer exists.
  onNotFound?: () => void
  // Passed through to the profile card's "Not you?" button; see EmployeeProfile.
  onNotYou?: () => void
}

/** A person's profile card, resume summary and org chart: the body of the detail and profile pages. */
export function EmployeeDetailView({ id, backTo, onNotFound, onNotYou }: EmployeeDetailViewProps) {
  const navigate = useNavigate()
  // Held in a ref so a parent passing a fresh function each render doesn't refetch.
  const onNotFoundRef = useRef(onNotFound)
  useEffect(() => {
    onNotFoundRef.current = onNotFound
  })

  const [employee, setEmployee] = useState<Employee | null>(null)
  const [managerChain, setManagerChain] = useState<Employee[]>([])
  const [orgChart, setOrgChart] = useState<OrgNode | null>(null)
  // The employee and everyone reporting to the same manager. Fetched after the
  // manager chain, since the manager's id comes out of it.
  const [peers, setPeers] = useState<Employee[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
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
        if (err instanceof Error && err.message === 'not-found') onNotFoundRef.current?.()
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [id])

  return (
    <>
      {/* Exactly 2/5 and 3/5 of the row at every width: the flex-basis pair is in the same
          2:3 ratio as the grow pair and sums to 900, so the 24px gap is charged to each
          column in precisely the proportion the grow factors would. Edit one basis without
          the other and the split silently stops being exact. flex-wrap rather than a media
          query (index.css is the only stylesheet, and inline styles cannot express one)
          stacks the row below ~1036px of viewport. align-items is flex-start so the profile
          card keeps its natural height beside a summary panel that grows as it loads. */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'flex-start',
          gap: 24,
          width: '100%',
          maxWidth: 1200,
          margin: '0 auto',
        }}
      >
        <div style={{ flex: '2 1 360px', minWidth: 0 }}>
          {loading && (
            <div style={{ marginTop: 16 }}>
              <SkeletonText paragraph lineCount={3} />
            </div>
          )}
          {error && <InlineNotification kind="error" title="Couldn't load employee" subtitle={error} hideCloseButton />}

          {employee && (
            <EmployeeProfile employee={employee} onNotYou={onNotYou} />
          )}
        </div>

        {/* Keyed on the route id, not the loaded employee, so the slow summary call
            starts alongside the profile fetch instead of after it. */}
        {!error && (
          <div style={{ flex: '3 1 540px', minWidth: 0 }}>
            <ResumeSummaryPanel key={id} employeeId={id} />
          </div>
        )}
      </div>

      {/* Full width below the row, deliberately outside the 1200 cap: a full peer row is far
          wider than either tile above it. */}
      {orgChart && employee && (
        <OrgChart
          // Remount per employee, so expansions, the folded manager chain and the
          // viewport all reset rather than carrying over to a different person.
          key={employee.id}
          managerChain={managerChain}
          orgNode={orgChart}
          peers={peers}
          selfEmployee={employee}
          selectedId={employee.id}
          onSelect={(selectedId) => navigate(`/employee/${selectedId}${backTo ? `?${backTo}` : ''}`)}
        />
      )}
    </>
  )
}
