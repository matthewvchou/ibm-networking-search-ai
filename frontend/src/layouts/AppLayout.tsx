import { Content, Theme } from '@carbon/react'
import { Outlet } from 'react-router'
import { AppHeader } from '../components/AppHeader'
import { ThemeToggleButton } from '../components/ThemeToggleButton'
import { useIdentity } from '../identity/Identity'
import { IdentityPicker } from '../identity/IdentityPicker'
import { useColorTheme } from '../theme/ColorTheme'

export function AppLayout() {
  const { theme } = useColorTheme()
  const { identity, isGateSkipped } = useIdentity()

  // The startup gate: shown in place of whatever route was asked for, which is left
  // untouched in the URL, so a pasted deep link opens once the user has picked or skipped.
  if (!identity && !isGateSkipped) {
    return (
      <Theme theme={theme}>
        <Content>
          <IdentityPicker canSkip />
        </Content>
        <ThemeToggleButton />
      </Theme>
    )
  }

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
