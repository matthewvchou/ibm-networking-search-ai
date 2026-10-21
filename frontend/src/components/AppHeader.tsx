import { useState } from 'react'
import type { FormEvent } from 'react'
import { Header, HeaderName, Link as CarbonLink, Search } from '@carbon/react'
import { User } from '@carbon/icons-react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router'
import { useIdentity } from '../identity/Identity'

export function AppHeader() {
  const location = useLocation()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { identity } = useIdentity()
  const profileLabel = identity ? 'My profile' : 'Set up profile'
  const q = searchParams.get('q')
  const [inputValue, setInputValue] = useState('')

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const trimmed = inputValue.trim()
    navigate(trimmed ? `/?q=${encodeURIComponent(trimmed)}` : '/')
  }

  const isEmployeeDetail = location.pathname.startsWith('/employee/')

  return (
    <Header aria-label="IBM Directory">
      <HeaderName as={Link} to="/" prefix="IBM">
        Directory
      </HeaderName>
      {location.pathname !== '/' && (
        <form onSubmit={handleSubmit} style={{ display: 'flex', alignItems: 'center', marginLeft: 16 }}>
          <Search
            id="header-search"
            size="sm"
            labelText="Search employees"
            placeholder="Search employees…"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
          />
        </form>
      )}
      {/* The auto margin right-aligns this group; the global bar then shrinks to its own
          content rather than eating the free space (auto margins win over flex-grow). */}
      <div style={{ marginLeft: 'auto', marginRight: 16, display: 'flex', alignItems: 'center', gap: 16 }}>
        {isEmployeeDetail && (
          <CarbonLink as={Link} to={q ? `/?q=${encodeURIComponent(q)}` : '/'} style={{ whiteSpace: 'nowrap' }}>
            {q ? '← Back to search results' : '← Back to search'}
          </CarbonLink>
        )}
        {/* An icon-only link, so the label lives in aria-label and title (the hover tooltip). */}
        <CarbonLink
          as={Link}
          to="/profile"
          aria-label={profileLabel}
          title={profileLabel}
          style={{ display: 'flex', alignItems: 'center' }}
        >
          <User size={20} />
        </CarbonLink>
      </div>
    </Header>
  )
}
