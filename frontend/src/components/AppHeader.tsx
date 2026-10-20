import { useState } from 'react'
import type { FormEvent } from 'react'
import { Header, HeaderName, Link as CarbonLink, Search } from '@carbon/react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router'

export function AppHeader() {
  const location = useLocation()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
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
      {isEmployeeDetail && (
        // The auto margin right-aligns the link; the global bar then shrinks to its
        // own content rather than eating the free space (auto margins win over flex-grow).
        <CarbonLink
          as={Link}
          to={q ? `/?q=${encodeURIComponent(q)}` : '/'}
          style={{ marginLeft: 'auto', marginRight: 16, whiteSpace: 'nowrap' }}
        >
          {q ? '← Back to search results' : '← Back to search'}
        </CarbonLink>
      )}
    </Header>
  )
}
