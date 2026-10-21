import { useParams, useSearchParams } from 'react-router'
import { EmployeeDetailView } from '../components/EmployeeDetailView'

export function EmployeeDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  // The whole search string is carried through, not just ?q=, so a job-title filter
  // survives a trip into a profile and back.
  const backTo = searchParams.toString()

  return (
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
      {id && <EmployeeDetailView id={id} backTo={backTo} />}
    </div>
  )
}
