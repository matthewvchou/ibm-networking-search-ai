import { useEffect, useState } from 'react'
import { InlineNotification, SkeletonText } from '@carbon/react'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import { getDirectReports, getEmployee, getManagerChain, getOrgChart } from '../api/client'
import type { Employee, OrgNode } from '../api/client'
import { errorMessage } from '../api/errors'
import { ChatPanel } from '../components/ChatPanel'
import { EmployeeProfile } from '../components/EmployeeProfile'
import { OrgChart } from '../components/OrgChart'
import { ResumeSummaryPanel } from '../components/ResumeSummaryPanel'

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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, padding: 24, boxSizing: 'border-box' }}>
      {/* Profile and summary share the top row 2:3; flex-wrap stacks them on a narrow
          viewport. The org chart gets its own full-width row below, since a full peer
          row is far wider than either card. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 24 }}>
        <div style={{ flex: '2 1 380px', minWidth: 0 }}>
    // Carbon's Content already lays 2rem above this page, which overshoots the 30px gap
    // wanted under the header - hence no top padding of our own and a 2px pull-up, the
    // same trick SearchPage uses to claw back Content's padding.
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 24,
        padding: '0 24px 24px',
        marginTop: -2,
        boxSizing: 'border-box',
      }}
    >
      {/* Exactly 2/5 and 3/5 of the row at every width: the flex-basis pair is in the same
          2:3 ratio as the grow pair and sums to 900, so the 24px gap is charged to each
          column in precisely the proportion the grow factors would. Edit one basis without
          the other and the split silently stops being exact. flex-wrap rather than a media
          query (index.css is the only stylesheet, and inline styles cannot express one)
          stacks the row below ~1036px of viewport. align-items defaults to stretch, which
          is what makes the chat tile match the profile card's height. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, width: '100%', maxWidth: 1200, margin: '0 auto' }}>
        <div style={{ flex: '2 1 360px', minWidth: 0 }}>
          {loading && (
            <div style={{ marginTop: 16 }}>
              <SkeletonText paragraph lineCount={3} />
            </div>
          )}
          {error && <InlineNotification kind="error" title="Couldn't load employee" subtitle={error} hideCloseButton />}

          {employee && <EmployeeProfile employee={employee} manager={managerChain[1] ?? null} backTo={backTo} />}
        </div>

        {/* Keyed on the route id, not the loaded employee, so the slow summary call
            starts alongside the profile fetch instead of after it. */}
        {id && !error && (
          <div style={{ flex: '3 1 480px', minWidth: 0 }}>
            <ResumeSummaryPanel key={id} employeeId={id} />
          </div>
        )}
      </div>

      {orgChart && employee && (
        <div style={{ minWidth: 0 }}>
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
        <div style={{ flex: '3 1 540px', minWidth: 0 }}>
          <ChatPanel />
        </div>
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
          onSelect={(selectedId) =>
            navigate(`/employee/${selectedId}${backTo ? `?${backTo}` : ''}`)
          }
        />
      )}
    </div>
  )
}
