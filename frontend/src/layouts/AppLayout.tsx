import { Content, Theme } from '@carbon/react'
import { Outlet } from 'react-router'
import { AppHeader } from '../components/AppHeader'
import { ThemeToggleButton } from '../components/ThemeToggleButton'
import { useColorTheme } from '../theme/ColorTheme'

export function AppLayout() {
  const { theme } = useColorTheme()

  return (
    <Theme theme={theme}>
      <AppHeader />
      <Content>
        <Outlet />
      </Content>
      <ThemeToggleButton />
    </Theme>
  )
}
