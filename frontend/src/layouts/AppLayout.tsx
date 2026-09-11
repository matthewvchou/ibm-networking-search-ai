import { Content, Theme } from '@carbon/react'
import { Outlet } from 'react-router'
import { AppHeader } from '../components/AppHeader'

export function AppLayout() {
  return (
    <Theme theme="g10">
      <AppHeader />
      <Content>
        <Outlet />
      </Content>
    </Theme>
  )
}
