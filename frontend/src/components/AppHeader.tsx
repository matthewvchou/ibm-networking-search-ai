import { useState } from 'react'
import type { FormEvent } from 'react'
import { Header, HeaderName, Search } from '@carbon/react'
import { Link, useLocation, useNavigate } from 'react-router'

export function AppHeader() {
  const location = useLocation()
  const navigate = useNavigate()
  const [inputValue, setInputValue] = useState('')

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const trimmed = inputValue.trim()
    navigate(trimmed ? `/?q=${encodeURIComponent(trimmed)}` : '/')
  }

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
    </Header>
  )
}
