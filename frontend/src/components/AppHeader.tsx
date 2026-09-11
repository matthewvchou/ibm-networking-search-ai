import { Header, HeaderName } from '@carbon/react'
import { Link } from 'react-router'

export function AppHeader() {
  return (
    <Header aria-label="IBM Directory">
      <HeaderName as={Link} to="/" prefix="IBM">
        Directory
      </HeaderName>
    </Header>
  )
}
