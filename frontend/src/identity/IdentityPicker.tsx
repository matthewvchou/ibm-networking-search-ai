import { useState } from 'react'
import type { FormEvent } from 'react'
import { Button, InlineNotification, Search, SkeletonText } from '@carbon/react'
import { searchEmployees } from '../api/client'
import type { Employee } from '../api/client'
import { errorMessage } from '../api/errors'
import { EmployeeCard } from '../components/EmployeeCard'
import { useIdentity } from './Identity'

interface IdentityPickerProps {
  // Offers "Skip for now". The startup gate does; /profile does not, since the page
  // has nothing to show without knowing who you are.
  canSkip: boolean
}

/** Asks who the user is: a name search whose result cards each pick that person when clicked. */
export function IdentityPicker({ canSkip }: IdentityPickerProps) {
  const { setIdentity, skipGate } = useIdentity()
  const [inputValue, setInputValue] = useState('')
  const [searchedFor, setSearchedFor] = useState('')
  const [results, setResults] = useState<Employee[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const name = inputValue.trim()
    if (!name) return
    setSearchedFor(name)
    setLoading(true)
    setError(null)
    searchEmployees(name)
      .then((data) => setResults(data.results))
      .catch((err) => {
        setResults([])
        setError(errorMessage(err))
      })
      .finally(() => setLoading(false))
  }

  return (
    // The top padding keeps the block off the top edge: on the startup gate there is no
    // header above it, so without it the heading would sit hard against the viewport.
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '48px 24px 24px' }}>
      {/* Only the introduction is centred. The result grid below stays left-aligned and
          full width, like the search page's, so its column count is unaffected. */}
      <div style={{ textAlign: 'center' }}>
        <h1 style={{ fontSize: 28, fontWeight: 400, color: 'var(--text-h)', marginBottom: 8 }}>Who are you?</h1>
        <p style={{ margin: '0 auto 16px', maxWidth: 700 }}>
          Search for yourself, then click your card to continue. The directory will show your profile and suggest
          people to reach out to. This is remembered in this browser only; it is not a login.
        </p>
        <form
          onSubmit={handleSubmit}
          style={{ display: 'flex', alignItems: 'flex-end', gap: 8, maxWidth: 700, margin: '0 auto', textAlign: 'left' }}
        >
          <div style={{ flex: 1 }}>
            <Search
              id="identity-search"
              labelText="Search for yourself"
              placeholder="Search by name"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={!inputValue.trim()}>
            Search
          </Button>
        </form>
        {canSkip && (
          <div style={{ marginTop: 16 }}>
            <Button kind="ghost" size="sm" onClick={skipGate}>
              Skip for now
            </Button>
          </div>
        )}
      </div>

      {loading && (
        <div style={{ marginTop: 16 }}>
          <SkeletonText paragraph lineCount={3} />
        </div>
      )}
      {error && (
        <InlineNotification kind="error" title="Search failed" subtitle={error} hideCloseButton style={{ marginTop: 16 }} />
      )}
      {!loading && !error && searchedFor && results.length === 0 && (
        <InlineNotification
          kind="info"
          title="No results."
          subtitle=' Try adding a first name, e.g. "Lastname Firstname".'
          hideCloseButton
          style={{ marginTop: 16 }}
        />
      )}
      {!loading && results.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
            gap: 16,
            marginTop: 24,
          }}
        >
          {results.map((employee) => (
            <EmployeeCard
              key={employee.id}
              employee={employee}
              onClick={() => setIdentity({ id: employee.id, name: employee.display_name })}
            />
          ))}
        </div>
      )}
    </div>
  )
}
