import { EmployeeDetailView } from '../components/EmployeeDetailView'
import { SuggestionsSection } from '../components/SuggestionsSection'
import { useIdentity } from '../identity/Identity'
import { IdentityPicker } from '../identity/IdentityPicker'

export function ProfilePage() {
  const { identity, clearIdentity } = useIdentity()

  // Deliberately ignores "skip for now": this page has nothing to show without knowing who
  // you are, so a skipped session is asked again here.
  if (!identity) return <IdentityPicker canSkip={false} />

  return (
    // Same offset and spacing as EmployeeDetailPage, which shares this body.
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
      {/* Keyed on the id so switching identity resets the view and the suggestions. A saved
          id the directory no longer has is dropped, which sends the user back to the gate. */}
      <EmployeeDetailView
        key={identity.id}
        id={identity.id}
        backTo=""
        onNotFound={clearIdentity}
        onNotYou={clearIdentity}
      />
      <SuggestionsSection key={`suggestions-${identity.id}`} employeeId={identity.id} />
    </div>
  )
}
